import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1 } from "./linux-supervisor-source.js";
import {
  runSiteBuildDockerV1,
  siteBuildReadOnlyImageDataArgsV1,
  withSiteBuildDockerV1,
} from "./docker-host.js";

const execute = promisify(execFile);
const nativeEnabled =
  process.platform === "linux" &&
  process.getuid?.() === 0 &&
  process.env.NP_TEST_SITE_BUILD_LINUX_SUPERVISOR === "1";

// This is an actual Linux privileged-runner test, deliberately opt-in. A macOS
// source-string assertion would not prove native syscall or ptrace enforcement.
// The fixed renderer image runs these cases with the same capabilities as its
// supervisor, before any artifact from that image can be accepted.
const fixtureSource = String.raw`
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/prctl.h>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <sys/uio.h>
#include <linux/sched.h>
#include <linux/futex.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <linux/stat.h>
#include <linux/capability.h>
#include <stdint.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <errno.h>
#include <stdatomic.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char changing_path[4096];
static char permitted_path[4096];
static char forbidden_path[4096];
static atomic_int changing;
static atomic_int group_exit_ready;
static atomic_int group_exit_race_ready;
static atomic_int group_exit_leader_tid;
static atomic_int fatal_exit_ready;
static volatile sig_atomic_t restarted_child_signal;
static int restarted_child_notify = -1;

enum fatal_parent_exit { FATAL_GROUP_SIGNAL, FATAL_PARENT_EXIT, FATAL_PARENT_EXIT_GROUP, FATAL_PARENT_SELF_KILL };

static void *fatal_exit_worker(void *unused) {
  (void) unused;
  atomic_fetch_add(&fatal_exit_ready, 1);
  for (;;) syscall(SYS_gettid);
  return NULL;
}

static _Noreturn void fatal_exit_threads(int notify) {
  pthread_t threads[8];
  atomic_store(&fatal_exit_ready, 0);
  for (int i = 0; i < 8; i++)
    if (pthread_create(&threads[i], NULL, fatal_exit_worker, NULL)) _exit(89);
  while (atomic_load(&fatal_exit_ready) != 8) syscall(SYS_sched_yield);
  if (write(notify, "R", 1) != 1) _exit(90);
  for (;;) syscall(SYS_gettid);
}

static int fatal_exit_rounds(enum fatal_parent_exit parent_exit, int fatal_signal) {
  for (int round = 0; round < 32; round++) {
    int ready_pipe[2], go_pipe[2];
    if (pipe(ready_pipe) || pipe(go_pipe)) return 91;
    pid_t parent = fork();
    if (parent < 0) return 92;
    if (!parent) {
      close(ready_pipe[0]); close(go_pipe[1]);
      if (parent_exit == FATAL_GROUP_SIGNAL) {
        if (setpgid(0, 0)) _exit(93);
        fatal_exit_threads(ready_pipe[1]);
      }
      pid_t victim = fork();
      if (victim < 0) _exit(94);
      if (!victim) {
        close(go_pipe[0]);
        if (prctl(PR_SET_PDEATHSIG, SIGKILL)) _exit(95);
        fatal_exit_threads(ready_pipe[1]);
      }
      close(ready_pipe[1]);
      char byte;
      if (read(go_pipe[0], &byte, 1) != 1) _exit(96);
      if (parent_exit == FATAL_PARENT_EXIT) syscall(SYS_exit, 0);
      else if (parent_exit == FATAL_PARENT_EXIT_GROUP) syscall(SYS_exit_group, 0);
      else syscall(SYS_kill, getpid(), SIGKILL);
      _exit(97);
    }
    close(ready_pipe[1]); close(go_pipe[0]);
    char byte;
    if (read(ready_pipe[0], &byte, 1) != 1 || byte != 'R') return 98;
    if (parent_exit == FATAL_GROUP_SIGNAL) {
      if (kill(-parent, fatal_signal)) return 99;
    } else if (write(go_pipe[1], "X", 1) != 1) return 100;
    /* EOF requires every inherited writer, including all eight victim
     * threads killed by the parent's death, to have actually closed. */
    if (read(ready_pipe[0], &byte, 1) != 0) return 101;
    close(ready_pipe[0]); close(go_pipe[1]);
    int status;
    if (waitpid(parent, &status, 0) != parent) return 102;
    if (parent_exit == FATAL_GROUP_SIGNAL || parent_exit == FATAL_PARENT_SELF_KILL) {
      if (!WIFSIGNALED(status) || WTERMSIG(status) != fatal_signal) return 103;
    } else if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return 104;
    usleep(1000);
  }
  return 0;
}

static void restarted_child_handler(int signal) {
  int saved_errno = errno;
  (void) signal;
  restarted_child_signal = 1;
  if (restarted_child_notify >= 0) {
    ssize_t written = write(restarted_child_notify, "S", 1);
    (void) written;
  }
  errno = saved_errno;
}

static int wait_clean_child(pid_t child) {
  int status;
  pid_t result;
  do result = waitpid(child, &status, 0); while (result < 0 && errno == EINTR);
  return result == child && WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static int restarted_child_read(void) {
  int data[2], notify[2], ready[2];
  if (pipe(data) || pipe(notify) || pipe(ready)) return 105;
  struct sigaction action = { .sa_handler = restarted_child_handler, .sa_flags = SA_RESTART }, previous;
  sigemptyset(&action.sa_mask);
  restarted_child_signal = 0;
  restarted_child_notify = notify[1];
  if (sigaction(SIGCHLD, &action, &previous)) return 106;
  pid_t exiting = fork();
  if (exiting < 0) return 107;
  if (!exiting) {
    close(ready[1]);
    char byte;
    if (read(ready[0], &byte, 1) != 1) _exit(108);
    /* Let the parent enter its blocking data read before SIGCHLD. */
    usleep(20000);
    _exit(0);
  }
  pid_t writer = fork();
  if (writer < 0) return 109;
  if (!writer) {
    close(notify[1]); close(data[0]);
    char byte;
    if (read(notify[0], &byte, 1) != 1 || byte != 'S' || write(data[1], "W", 1) != 1)
      _exit(110);
    _exit(0);
  }
  close(ready[0]); close(data[1]);
  if (write(ready[1], "R", 1) != 1) return 111;
  close(ready[1]);
  char byte;
  /* The ordinary handler must run and the separate writer must then make
   * progress while this SA_RESTART read remains in flight. */
  if (read(data[0], &byte, 1) != 1 || byte != 'W' || !restarted_child_signal) return 112;
  if (!wait_clean_child(exiting) || !wait_clean_child(writer)) return 113;
  if (sigaction(SIGCHLD, &previous, NULL)) return 114;
  restarted_child_notify = -1;
  close(data[0]); close(notify[0]); close(notify[1]);
  return 0;
}

static void *group_exit_last_worker(void *unused) {
  (void) unused;
  atomic_store(&group_exit_ready, 1);
  syscall(SYS_futex, &group_exit_ready, FUTEX_WAKE_PRIVATE, 1, NULL, NULL, 0);
  /* clear_child_tid runs after the leader's traced EXIT stop is resumed.
   * The leader cannot retire until this final thread exits its group. */
  while (atomic_load(&group_exit_leader_tid)) syscall(SYS_sched_yield);
  syscall(SYS_exit_group, 0);
  return NULL;
}

static void *group_exit_race_worker(void *unused) {
  (void) unused;
  atomic_fetch_add(&group_exit_race_ready, 1);
  for (;;) syscall(SYS_gettid);
  return NULL;
}

static void *group_exit_worker(void *unused) {
  (void) unused;
  atomic_store(&group_exit_ready, 1);
  syscall(SYS_futex, &group_exit_ready, FUTEX_WAKE_PRIVATE, 1, NULL, NULL, 0);
  for (;;) syscall(SYS_futex, &group_exit_ready, FUTEX_WAIT_PRIVATE, 1, NULL, NULL, 0);
  return NULL;
}

static void *change_path(void *unused) {
  (void) unused;
  while (atomic_load(&changing)) {
    memcpy(changing_path, permitted_path, strlen(permitted_path) + 1);
    usleep(10);
    memcpy(changing_path, forbidden_path, strlen(forbidden_path) + 1);
    usleep(1000);
  }
  return NULL;
}

enum blocking_write_family {
  BLOCKING_WRITE, BLOCKING_WRITEV, BLOCKING_SENDTO, BLOCKING_SENDMSG, BLOCKING_SENDMMSG
};

static unsigned char blocking_payload_byte(size_t offset) {
  return (unsigned char) ((offset * 17U + 31U) % 251U);
}

static uint64_t blocking_payload_hash(uint64_t hash, const unsigned char *bytes, size_t count) {
  for (size_t i = 0; i < count; i++) {
    hash ^= bytes[i];
    hash *= UINT64_C(1099511628211);
  }
  return hash;
}

static ssize_t blocking_send_bytes(int fd, enum blocking_write_family family,
    unsigned char *bytes, size_t count) {
  size_t first = count / 2;
  struct iovec vectors[2] = { { bytes, first }, { bytes + first, count - first } };
  if (family == BLOCKING_WRITE) return write(fd, bytes, count);
  if (family == BLOCKING_WRITEV) return writev(fd, vectors, 2);
  if (family == BLOCKING_SENDTO) return sendto(fd, bytes, count, 0, NULL, 0);
  struct msghdr message = { .msg_iov = vectors, .msg_iovlen = 2 };
  if (family == BLOCKING_SENDMSG) return sendmsg(fd, &message, 0);
  if (family == BLOCKING_SENDMMSG) {
    /* sendmmsg returns a MESSAGE count. Advance only the one message's
     * actual byte count, including a successful partial stream send. */
    struct mmsghdr messages[1] = { { .msg_hdr = message } };
    int sent = sendmmsg(fd, messages, 1, 0);
    if (sent < 0) return -1;
    if (sent != 1 || !messages[0].msg_len || messages[0].msg_len > count) {
      errno = EIO;
      return -1;
    }
    return (ssize_t) messages[0].msg_len;
  }
  errno = EINVAL;
  return -1;
}

static int blocking_ack_write(int fd, const uint64_t receipt[2]) {
  size_t offset = 0;
  while (offset < 2 * sizeof(uint64_t)) {
    ssize_t count = write(fd, (const char *) receipt + offset, 2 * sizeof(uint64_t) - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return 0;
    offset += (size_t) count;
  }
  return 1;
}

static int blocking_write_progress(enum blocking_write_family family, int use_socket) {
  int channel[2], ack[2];
  size_t total = use_socket ? 1024U * 1024U : 256U * 1024U;
  if ((use_socket ? socketpair(AF_UNIX, SOCK_STREAM, 0, channel) : pipe(channel)) || pipe(ack)) return 115;
  unsigned char *payload = malloc(total);
  if (!payload) return 116;
  for (size_t i = 0; i < total; i++) payload[i] = blocking_payload_byte(i);
  uint64_t expected_hash = blocking_payload_hash(UINT64_C(14695981039346656037), payload, total);
  pid_t reader = fork();
  if (reader < 0) return 117;
  if (!reader) {
    close(channel[1]); close(ack[0]);
    unsigned char buffer[65536];
    size_t received = 0;
    uint64_t hash = UINT64_C(14695981039346656037);
    for (;;) {
      ssize_t count = read(channel[0], buffer, sizeof(buffer));
      if (count < 0 && errno == EINTR) continue;
      if (count < 0) _exit(118);
      if (!count) break;
      if ((size_t) count > total - received) _exit(119);
      for (ssize_t i = 0; i < count; i++)
        if (buffer[i] != blocking_payload_byte(received + (size_t) i)) _exit(120);
      received += (size_t) count;
      hash = blocking_payload_hash(hash, buffer, (size_t) count);
    }
    if (received != total || hash != expected_hash) _exit(121);
    uint64_t receipt[2] = { (uint64_t) received, hash };
    if (!blocking_ack_write(ack[1], receipt)) _exit(122);
    close(channel[0]); close(ack[1]);
    free(payload);
    _exit(0);
  }
  close(channel[0]); close(ack[1]);
  size_t sent = 0;
  while (sent < total) {
    ssize_t count = blocking_send_bytes(channel[1], family, payload + sent, total - sent);
    /* Ordinary EINTR is retried. Kernel auto-restart is transparent; a
     * positive partial result advances exactly the bytes actually sent. */
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0 || (size_t) count > total - sent) return 123;
    sent += (size_t) count;
  }
  free(payload);
  close(channel[1]);
  uint64_t receipt[2];
  size_t received = 0;
  while (received < sizeof(receipt)) {
    ssize_t count = read(ack[0], (char *) receipt + received, sizeof(receipt) - received);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return 124;
    received += (size_t) count;
  }
  close(ack[0]);
  int status;
  pid_t waited;
  do waited = waitpid(reader, &status, 0); while (waited < 0 && errno == EINTR);
  if (waited != reader || !WIFEXITED(status) || WEXITSTATUS(status)) return 125;
  if (receipt[0] != total || receipt[1] != expected_hash) return 126;
  return 0;
}

int main(int argc, char **argv) {
  char mode[80], output[4096], path[4096];
  FILE *input;
  int fd;
  int next_child = argc >= 4 && !strcmp(argv[1], "--import");
  mkdir(getenv("TMPDIR"), 0700);
  mkdir(getenv("HOME"), 0700);
  input = fopen(next_child ? argv[3] : argv[1], "r");
  if (!input || !fgets(mode, sizeof(mode), input)) return 2;
  fclose(input);
  mode[strcspn(mode, "\n")] = 0;
  snprintf(output, sizeof(output), "%s/../result.txt", getenv("TMPDIR"));
  static const struct {
    const char *mode;
    enum fatal_parent_exit parent_exit;
    int signal;
  } fatal_exits[] = {
    { "fatal-group-sigkill", FATAL_GROUP_SIGNAL, SIGKILL },
    { "fatal-group-sigterm", FATAL_GROUP_SIGNAL, SIGTERM },
    { "fatal-group-sigpipe", FATAL_GROUP_SIGNAL, SIGPIPE },
    { "fatal-group-sigabrt", FATAL_GROUP_SIGNAL, SIGABRT },
    { "fatal-parent-exit-pdeath", FATAL_PARENT_EXIT, SIGKILL },
    { "fatal-parent-exit-group-pdeath", FATAL_PARENT_EXIT_GROUP, SIGKILL },
    { "fatal-parent-self-kill-pdeath", FATAL_PARENT_SELF_KILL, SIGKILL }
  };
  for (size_t i = 0; i < sizeof(fatal_exits) / sizeof(fatal_exits[0]); i++)
    if (!strcmp(mode, fatal_exits[i].mode))
      return fatal_exit_rounds(fatal_exits[i].parent_exit, fatal_exits[i].signal);
  if (!strcmp(mode, "sigchld-restart-read")) return restarted_child_read();
  static const struct {
    const char *mode;
    enum blocking_write_family family;
    int use_socket;
  } blocking_writes[] = {
    { "blocking-pipe-write", BLOCKING_WRITE, 0 },
    { "blocking-pipe-writev", BLOCKING_WRITEV, 0 },
    { "blocking-unix-write", BLOCKING_WRITE, 1 },
    { "blocking-unix-writev", BLOCKING_WRITEV, 1 },
    { "blocking-unix-sendto", BLOCKING_SENDTO, 1 },
    { "blocking-unix-sendmsg", BLOCKING_SENDMSG, 1 },
    { "blocking-unix-sendmmsg", BLOCKING_SENDMMSG, 1 }
  };
  for (size_t i = 0; i < sizeof(blocking_writes) / sizeof(blocking_writes[0]); i++)
    if (!strcmp(mode, blocking_writes[i].mode))
      return blocking_write_progress(blocking_writes[i].family, blocking_writes[i].use_socket);
  if (!strcmp(mode, "group-exit-leader-first")) {
    for (int round = 0; round < 8; round++) {
      pid_t child = fork();
      if (child < 0) return 85;
      if (!child) {
        pthread_t thread;
        atomic_store(&group_exit_ready, 0);
        atomic_store(&group_exit_leader_tid, 1);
        if (syscall(SYS_set_tid_address, &group_exit_leader_tid) <= 0 ||
            pthread_create(&thread, NULL, group_exit_last_worker, NULL)) return 86;
        while (!atomic_load(&group_exit_ready))
          syscall(SYS_futex, &group_exit_ready, FUTEX_WAIT_PRIVATE, 0, NULL, NULL, 0);
        syscall(SYS_exit, 0);
        return 87;
      }
      int status;
      if (waitpid(child, &status, 0) != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0)
        return 88;
    }
    return 0;
  }
  if (!strcmp(mode, "group-exit-race")) {
    /* Harmless peer syscalls run concurrently until exit_group freezes the
     * whole group. Every round must retire all threads before the next fork. */
    for (int round = 0; round < 32; round++) {
      pid_t child = fork();
      if (child < 0) return 81;
      if (!child) {
        pthread_t threads[8];
        for (int i = 0; i < 8; i++)
          if (pthread_create(&threads[i], NULL, group_exit_race_worker, NULL)) return 82;
        while (atomic_load(&group_exit_race_ready) != 8) syscall(SYS_sched_yield);
        syscall(SYS_exit_group, 0);
        return 83;
      }
      int status;
      if (waitpid(child, &status, 0) != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0)
        return 84;
    }
    return 0;
  }
  if (!strncmp(mode, "group-exit-", 11)) {
    pid_t child = fork();
    if (child < 0) return 75;
    if (!child) {
      pthread_t thread;
      if (pthread_create(&thread, NULL, group_exit_worker, NULL)) return 76;
      while (!atomic_load(&group_exit_ready))
        syscall(SYS_futex, &group_exit_ready, FUTEX_WAIT_PRIVATE, 0, NULL, NULL, 0);
      if (!strcmp(mode, "group-exit-clean")) _exit(0);
      if (!strcmp(mode, "group-exit-tgkill"))
        syscall(SYS_tgkill, getpid(), syscall(SYS_gettid), SIGKILL);
      else if (!strcmp(mode, "group-exit-kill")) syscall(SYS_kill, getpid(), SIGKILL);
      return 77;
    }
    int status;
    if (waitpid(child, &status, 0) != child) return 78;
    if (!strcmp(mode, "group-exit-clean"))
      return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : 79;
    return WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL ? 0 : 80;
  }
  if (!strncmp(mode, "diagnostic-", 11)) {
    static const struct { const char *mode; const char *target; } targets[] = {
      { "diagnostic-project", "/np/project" },
      { "diagnostic-source", "/np/project/source-new" },
      { "diagnostic-dependencies", "/np/project/node_modules" },
      { "diagnostic-dependencies-boundary", "/np/project/node_modules-other" },
      { "diagnostic-next", "/np/project/.next" },
      { "diagnostic-next-cache", "/np/project/.next/cache/new" },
      { "diagnostic-next-server", "/np/project/.next/server/new" },
      { "diagnostic-next-server-file", "/np/project/.next/server/existing" },
      { "diagnostic-next-server-link", "/np/project/server-link" },
      { "diagnostic-next-server-boundary", "/np/project/.next/server-other" },
      { "diagnostic-standalone", "/np/project/.next/standalone" },
      { "diagnostic-standalone-next", "/np/project/.next/standalone/.next" },
      { "diagnostic-standalone-cache", "/np/project/.next/standalone/.next/cache/new" },
      { "diagnostic-standalone-server", "/np/project/.next/standalone/.next/server/new" },
      { "diagnostic-standalone-server-boundary", "/np/project/.next/standalone/.next/server-other" },
      { "diagnostic-output", "/np/output/new" },
      { "diagnostic-cache-output", "/np/project/.next/cache-output/new" },
      { "diagnostic-proc", "/proc/version" },
      { "diagnostic-sys", "/sys" },
      { "diagnostic-dev", "/dev/zero" },
      { "diagnostic-tmp", "/tmp" },
      { "diagnostic-tmp-boundary", "/tmp-other" },
      { "diagnostic-run", "/run" },
      { "diagnostic-image", "/usr" },
      { "diagnostic-other", "/np/new" },
      { "diagnostic-credential", "/np/project/.env.secret" }
    };
    if (!strcmp(mode, "diagnostic-unresolved")) {
      syscall(SYS_mkdirat, 999, "new", 0700); return 0;
    }
    if (!strcmp(mode, "diagnostic-supervisor")) {
      snprintf(path, sizeof(path), "/proc/%ld/status", (long) getppid());
      syscall(SYS_mkdirat, AT_FDCWD, path, 0700); return 0;
    }
    for (size_t i = 0; i < sizeof(targets) / sizeof(targets[0]); i++) {
      if (!strcmp(mode, targets[i].mode)) {
        syscall(SYS_mkdirat, AT_FDCWD, targets[i].target, 0700); return 0;
      }
    }
    return 74;
  }
  if (!strncmp(mode, "next-", 5)) {
    const char *entry = "/np/project/.next/standalone/server.js";
    const char *clock = !strcmp(mode, "next-wrong-clock") ? "/opt/np/driver/other.mjs" : "/opt/np/driver/clock.mjs";
    if (!next_child && strcmp(mode, "next-foreign-role") && strcmp(mode, "next-chromium-role") && strcmp(mode, "next-postgres-role")) {
      char *args[] = { "/usr/local/bin/node", "--import", (char *) clock, (char *) entry,
        !strcmp(mode, "next-extra-argv") ? "extra" : NULL, NULL };
      execv(args[0], args);
      return 70;
    }
    strcpy(path, "/np/project/.next/standalone/.env.production.local");
    if (!strcmp(mode, "next-alternate")) strcpy(path, "/np/project/.next/standalone/.env.secret");
    if (!strcmp(mode, "next-relative")) strcpy(path, ".next/standalone/.env.production.local");
    if (!strcmp(mode, "next-open") || !strcmp(mode, "next-read")) { open(path, O_RDONLY); return 0; }
    if (!strcmp(mode, "next-write")) { open(path, O_WRONLY | O_CREAT, 0600); return 0; }
    if (!strcmp(mode, "next-access")) { access(path, R_OK); return 0; }
    if (!strcmp(mode, "next-readlink")) { char target[4096]; readlink(path, target, sizeof(target)); return 0; }
    if (!strcmp(mode, "next-fstatat")) { struct stat st; fstatat(AT_FDCWD, path, &st, 0); return 0; }
    if (!strcmp(mode, "next-thread-race")) {
      strcpy(permitted_path, path); strcpy(forbidden_path, "/np/project/.next/standalone/.env.secret");
      strcpy(changing_path, forbidden_path); atomic_store(&changing, 1); pthread_t thread;
      if (pthread_create(&thread, NULL, change_path, NULL)) return 71;
      for (int i = 0; i < 100; i++) { struct statx st; syscall(SYS_statx, AT_FDCWD, changing_path, 0, 4095, &st, 4095); }
      atomic_store(&changing, 0); pthread_join(thread, NULL); return 72;
    }
    const char *names[] = { ".env.production.local", ".env.local", ".env.production", ".env" };
    int count = !strcmp(mode, "next-four") ? 4 : !strcmp(mode, "next-cap") ? 16 : !strcmp(mode, "next-cap-overflow") ? 17 : !strcmp(mode, "next-parent-cas") ? 2 : 1;
    for (int i = 0; i < count; i++) {
      struct statx st; unsigned char expected[sizeof(st)]; memset(&st, 0xa5, sizeof(st)); memset(expected, 0xa5, sizeof(expected));
      if (!strcmp(mode, "next-four")) snprintf(path, sizeof(path), "/np/project/.next/standalone/%s", names[i]);
      unsigned flags = !strcmp(mode, "next-flags") ? AT_SYMLINK_NOFOLLOW : 0;
      unsigned mask = !strcmp(mode, "next-mask") ? STATX_BASIC_STATS : 4095;
      unsigned extra = !strcmp(mode, "next-extra-register") ? 0 : 4095;
      int directory = !strcmp(mode, "next-dirfd") ? 0 : AT_FDCWD;
      errno = 0;
      uint64_t first = !strcmp(mode, "next-dirfd-high") ? (uint64_t) (int64_t) AT_FDCWD : (uint64_t) (uint32_t) directory;
      long result = syscall(SYS_statx, first, path, flags, mask, !strcmp(mode, "next-null-buffer") ? NULL : &st, extra);
      if (result != -1 || errno != ENOENT || memcmp(&st, expected, sizeof(st))) return 73;
      if (!strcmp(mode, "next-parent-cas") && i == 0) usleep(3000000);
    }
    return 0;
  }
  if (!strcmp(mode, "ok")) {
    fd = open("public.txt", O_RDONLY);
    if (fd < 0) return 3;
    close(fd);
    fd = open(output, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0 || write(fd, "safe", 4) != 4) return 4;
    close(fd);
    pid_t child = fork();
    if (child < 0) return 5;
    if (!child) _exit(0);
    if (waitpid(child, NULL, 0) != child) return 6;
    return 0;
  }
  if (!strcmp(mode, "dangling")) {
    struct stat st;
    if (symlink("missing-leaf", output)) return 28;
    errno = 0;
    return stat(output, &st) == -1 && errno == ENOENT ? 0 : 29;
  } else if (!strcmp(mode, "empty-negative")) {
    struct stat st;
    errno = 0;
    return fstatat(AT_FDCWD, "", &st, AT_SYMLINK_NOFOLLOW) == -1 && errno == ENOENT ? 0 : 34;
  } else if (!strcmp(mode, "retired-stat") || !strcmp(mode, "retired-stat-write")) {
    pid_t child = fork();
    if (child < 0) return 35;
    if (!child) _exit(0);
    if (waitpid(child, NULL, 0) != child) return 36;
    snprintf(path, sizeof(path), "/proc/%ld/stat", (long) child);
    fd = open(path, !strcmp(mode, "retired-stat") ? O_RDONLY : O_WRONLY);
    return 0;
  } else if (!strcmp(mode, "nscd-negative") || !strcmp(mode, "nscd-unregistered")) {
    struct sockaddr_un destination = { .sun_family = AF_UNIX };
    strcpy(destination.sun_path, "/run/nscd/socket");
    fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return 37;
    errno = 0;
    return connect(fd, (struct sockaddr *) &destination, sizeof(destination)) == -1 && errno == ENOENT ? 0 : 38;
  } else if (!strcmp(mode, "metadata-empty")) {
    struct statx st;
    fd = open("public.txt", O_RDONLY);
    if (fd < 0) return 30;
    return syscall(SYS_statx, fd, "", AT_EMPTY_PATH, STATX_BASIC_STATS, &st) ? 31 : 0;
  } else if (!strcmp(mode, "retired-zombie") || !strcmp(mode, "retired-zombie-group")) {
    pid_t child = fork();
    if (child < 0) return 40;
    if (!child) { if (!strcmp(mode, "retired-zombie-group") && setsid() < 0) _exit(41); _exit(0); }
    usleep(100000);
    if (syscall(SYS_kill, !strcmp(mode, "retired-zombie-group") ? (uint64_t) (uint32_t) -child : (uint64_t) child, 0)) return 42;
    return waitpid(child, NULL, 0) == child ? 0 : 43;
  } else if (!strcmp(mode, "ambient-group")) {
    syscall(SYS_kill, (uint64_t) (uint32_t) -getpgrp(), 0);
  } else if (!strncmp(mode, "flush-", 6)) {
    uint64_t offset = 0, length = 8192;
    unsigned flags = SYNC_FILE_RANGE_WRITE;
    if (!strcmp(mode, "flush-source")) fd = open("public.txt", O_RDONLY);
    else if (!strcmp(mode, "flush-directory")) fd = open(getenv("TMPDIR"), O_RDONLY | O_DIRECTORY);
    else if (!strcmp(mode, "flush-memfd")) fd = memfd_create("owned", MFD_CLOEXEC);
    else fd = open(output, O_RDWR | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return 56;
    if (!strcmp(mode, "flush-other")) flags |= SYNC_FILE_RANGE_WAIT_BEFORE;
    if (!strcmp(mode, "flush-negative")) offset = UINT64_MAX;
    if (!strcmp(mode, "flush-zero")) length = 0;
    if (!strcmp(mode, "flush-large")) length = 16777217ULL;
    if (!strcmp(mode, "flush-overflow")) offset = 268435456ULL;
    return syscall(SYS_sync_file_range, fd, offset, length, flags) ? 57 : 0;
  } else if (!strncmp(mode, "advice-", 7)) {
    uint64_t offset = 0, length = 8192;
    int advice = POSIX_FADV_WILLNEED;
    if (!strcmp(mode, "advice-source")) fd = open("public.txt", O_RDONLY);
    else if (!strcmp(mode, "advice-directory")) fd = open(getenv("TMPDIR"), O_RDONLY | O_DIRECTORY);
    else if (!strcmp(mode, "advice-memfd")) fd = memfd_create("owned", MFD_CLOEXEC);
    else fd = open(output, O_RDWR | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return 54;
    if (!strcmp(mode, "advice-other")) advice = POSIX_FADV_DONTNEED;
    if (!strcmp(mode, "advice-negative")) offset = UINT64_MAX;
    if (!strcmp(mode, "advice-zero")) length = 0;
    if (!strcmp(mode, "advice-large")) length = 16777217ULL;
    if (!strcmp(mode, "advice-overflow")) offset = 268435456ULL;
    return syscall(SYS_fadvise64, fd, offset, length, advice) ? 55 : 0;
  } else if (!strncmp(mode, "pg-shm-", 7)) {
    struct shmid_ds info;
    int id;
    if (!strcmp(mode, "pg-shm-foreign-id")) { shmctl(12345, IPC_STAT, &info); return 0; }
    if (!strcmp(mode, "pg-shm-foreign-attach")) { shmat(12345, NULL, 0); return 0; }
    if (!strcmp(mode, "pg-shm-unrecorded-detach")) { shmdt((void *) 0x10000); return 0; }
    if (!strcmp(mode, "pg-shm-limit")) {
      for (int i = 0; i < 5; i++) shmget((key_t) (2367995 + i), 56, IPC_CREAT | IPC_EXCL | 0600);
      return 0;
    }
    int flags = IPC_CREAT | IPC_EXCL | 0600;
    if (!strcmp(mode, "pg-shm-flags")) flags = IPC_CREAT | IPC_EXCL | 0666;
    if (!strcmp(mode, "pg-shm-huge")) flags |= SHM_HUGETLB;
    if (!strcmp(mode, "pg-shm-lookup")) flags = 0600;
    id = shmget((key_t) 2367995, !strcmp(mode, "pg-shm-oversize") ? 57 : 56, flags);
    if (id < 0) return 46;
    if (!strcmp(mode, "pg-shm-leak")) return 0;
    if (!strcmp(mode, "pg-shm-terminated")) { raise(SIGTERM); return 47; }
    if (!strcmp(mode, "pg-shm-permissions")) { memset(&info, 0, sizeof(info)); shmctl(id, IPC_SET, &info); return 0; }
    if (!strcmp(mode, "pg-shm-attach-address")) { shmat(id, (void *) 0x10000, 0); return 0; }
    if (!strcmp(mode, "pg-shm-attach-flags")) { shmat(id, NULL, SHM_RDONLY); return 0; }
    char *address = shmat(id, NULL, 0);
    if (address == (void *) -1 || shmctl(id, IPC_STAT, &info) || info.shm_segsz != 56 || info.shm_perm.uid != 1000) return 48;
    address[0] = 7;
    if (!strcmp(mode, "pg-shm-address")) { shmdt(address + 1); return 0; }
    if (!strcmp(mode, "pg-shm-fork")) {
      pid_t child = fork();
      if (child < 0) return 49;
      if (!child) { address[0] = 9; if (shmdt(address)) _exit(50); _exit(0); }
      if (waitpid(child, NULL, 0) != child || address[0] != 9) return 51;
    }
    if (!strcmp(mode, "pg-shm-rmid-attached")) {
      if (shmctl(id, IPC_RMID, NULL) || shmctl(id, IPC_STAT, &info) || shmdt(address)) return 52;
    } else if (shmdt(address) || shmctl(id, IPC_RMID, NULL)) return 53;
    return 0;
  } else if (!strcmp(mode, "ambient-get")) {
    return prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_IS_SET, 0UL, 0UL, 0UL) == 0 ? 0 : 45;
  } else if (!strcmp(mode, "ambient-raise")) {
    syscall(SYS_prctl, PR_CAP_AMBIENT, PR_CAP_AMBIENT_RAISE, 0UL, 0UL, 0UL);
  } else if (!strcmp(mode, "ambient-invalid")) {
    syscall(SYS_prctl, PR_CAP_AMBIENT, PR_CAP_AMBIENT_IS_SET, (unsigned long) CAP_LAST_CAP + 1, 0UL, 0UL);
  } else if (!strcmp(mode, "ambient-extra")) {
    syscall(SYS_prctl, PR_CAP_AMBIENT, PR_CAP_AMBIENT_IS_SET, 0UL, 1UL, 0UL);
  } else if (!strcmp(mode, "securebits-get")) {
    return prctl(PR_GET_SECUREBITS, 0UL, 0UL, 0UL, 0UL) >= 0 ? 0 : 44;
  } else if (!strcmp(mode, "securebits-set")) {
    syscall(SYS_prctl, PR_SET_SECUREBITS, 0UL, 0UL, 0UL, 0UL);
  } else if (!strcmp(mode, "securebits-extra")) {
    syscall(SYS_prctl, PR_GET_SECUREBITS, 1UL, 0UL, 0UL, 0UL);
  } else if (!strcmp(mode, "group")) {
    if (setsid() < 0) return 32;
    return syscall(SYS_kill, (uint64_t) (uint32_t) -getpid(), 0) ? 33 : 0;
  } else if (!strcmp(mode, "credential-link")) {
    syscall(SYS_openat, AT_FDCWD, "credential-link", O_RDONLY, 0);
  } else if (!strcmp(mode, "credential")) {
    /* The file is absent. The attempted access must still be sticky. */
    syscall(SYS_openat, AT_FDCWD, ".env.absent", O_RDONLY, 0);
  } else if (!strncmp(mode, "oom-", 4)) {
    snprintf(path, sizeof(path), "/proc/%ld/oom_score_adj", (long) (!strcmp(mode, "oom-external") ? getppid() : getpid()));
    fd = open(path, O_WRONLY);
    if (fd < 0) return 16;
    if (!strcmp(mode, "oom-positive")) {
      if (write(fd, "10", 2) != 2) return 17;
      return 0;
    } else if (!strcmp(mode, "oom-negative")) {
      write(fd, "-1", 2);
    } else if (!strcmp(mode, "oom-decrease")) {
      if (write(fd, "500", 3) != 3) return 18;
      write(fd, "100", 3);
    } else if (!strcmp(mode, "oom-writev")) {
      struct iovec vector = { "100", 3 };
      syscall(SYS_writev, fd, &vector, 1);
    } else if (!strcmp(mode, "oom-mmap")) {
      syscall(SYS_mmap, NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    } else if (!strcmp(mode, "oom-truncate")) {
      syscall(SYS_ftruncate, fd, 0);
    } else return 19;
  } else if (!strncmp(mode, "clear-", 6)) {
    snprintf(path, sizeof(path), "/proc/%ld/clear_refs", (long) (!strcmp(mode, "clear-external") ? getppid() : getpid()));
    fd = open(path, O_WRONLY);
    if (fd < 0) return 24;
    if (!strcmp(mode, "clear-positive")) { if (write(fd, "5", 1) != 1) return 25; return 0; }
    else if (!strcmp(mode, "clear-one")) write(fd, "1", 1);
    else if (!strcmp(mode, "clear-zero")) write(fd, "0", 1);
    else if (!strcmp(mode, "clear-newline")) write(fd, "5\n", 2);
    else if (!strcmp(mode, "clear-writev")) { struct iovec vector = { "5", 1 }; writev(fd, &vector, 1); }
    else if (!strcmp(mode, "clear-mmap")) syscall(SYS_mmap, NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    else if (!strcmp(mode, "clear-truncate")) syscall(SYS_ftruncate, fd, 0);
    else if (strcmp(mode, "clear-external") && strcmp(mode, "clear-unregistered")) return 26;
  } else if (!strncmp(mode, "udp-", 4)) {
    int family = !strcmp(mode, "udp-ipv4") ? AF_INET : AF_INET6;
    errno = 0;
    fd = socket(family, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    return fd == -1 && errno == EAFNOSUPPORT ? 0 : 27;
  } else if (!strncmp(mode, "route-", 6) || !strcmp(mode, "uevent-write")) {
    struct sockaddr_nl destination = { .nl_family = AF_NETLINK };
    struct { struct nlmsghdr header; struct rtgenmsg body; } request;
    memset(&request, 0, sizeof(request));
    request.header.nlmsg_len = sizeof(struct nlmsghdr) + sizeof(struct rtgenmsg);
    request.header.nlmsg_type = !strcmp(mode, "route-read") ? RTM_GETLINK : RTM_NEWLINK;
    request.header.nlmsg_flags = NLM_F_REQUEST | NLM_F_DUMP;
    request.header.nlmsg_seq = 1;
    request.body.rtgen_family = AF_UNSPEC;
    int protocol = !strcmp(mode, "route-other-protocol") ? NETLINK_USERSOCK :
      !strcmp(mode, "uevent-write") ? NETLINK_KOBJECT_UEVENT : NETLINK_ROUTE;
    fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC | SOCK_NONBLOCK, protocol);
    if (fd < 0) return 20;
    if (!strcmp(mode, "route-userspace-peer")) {
      destination.nl_pid = (unsigned) getpid();
      connect(fd, (struct sockaddr *) &destination, sizeof(destination));
    } else if (!strcmp(mode, "route-mutate-write")) {
      if (connect(fd, (struct sockaddr *) &destination, sizeof(destination))) return 21;
      write(fd, &request, request.header.nlmsg_len);
    } else if (!strcmp(mode, "route-mutate-writev")) {
      struct iovec vector = { &request, request.header.nlmsg_len };
      if (connect(fd, (struct sockaddr *) &destination, sizeof(destination))) return 22;
      writev(fd, &vector, 1);
    } else if (!strcmp(mode, "route-mutate-sendmsg")) {
      struct iovec vector = { &request, request.header.nlmsg_len };
      struct msghdr message = { .msg_name = &destination, .msg_namelen = sizeof(destination),
        .msg_iov = &vector, .msg_iovlen = 1 };
      sendmsg(fd, &message, 0);
    } else {
      ssize_t sent = sendto(fd, &request, request.header.nlmsg_len, 0, (struct sockaddr *) &destination, sizeof(destination));
      if (!strcmp(mode, "route-read")) return sent == (ssize_t) request.header.nlmsg_len ? 0 : 23;
    }
  } else if (!strcmp(mode, "write")) {
    syscall(SYS_openat, AT_FDCWD, "public.txt", O_WRONLY | O_TRUNC, 0);
  } else if (!strcmp(mode, "shared-map-write")) {
    fd = open("public.txt", O_RDONLY);
    if (fd < 0) return 14;
    void *mapped = mmap(NULL, 4096, PROT_READ, MAP_SHARED, fd, 0);
    if (mapped == MAP_FAILED) return 15;
    syscall(SYS_mprotect, mapped, 4096, PROT_READ | PROT_WRITE);
  } else if (!strcmp(mode, "unbound-listen")) {
    fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return 39;
    listen(fd, 1);
  } else if (!strcmp(mode, "egress")) {
    struct sockaddr_in destination = { .sin_family = AF_INET, .sin_port = htons(18080) };
    inet_pton(AF_INET, "127.0.0.2", &destination.sin_addr);
    fd = socket(AF_INET, SOCK_STREAM, 0);
    syscall(SYS_connect, fd, &destination, sizeof(destination));
  } else if (!strcmp(mode, "sendto")) {
    struct sockaddr_in destination = { .sin_family = AF_INET, .sin_port = htons(443) };
    inet_pton(AF_INET, "192.0.2.1", &destination.sin_addr);
    fd = socket(AF_INET, SOCK_STREAM, 0);
    syscall(SYS_sendto, fd, "x", 1, MSG_FASTOPEN, &destination, sizeof(destination));
  } else if (!strcmp(mode, "exec")) {
    char *args[] = { "/bin/sh", "-c", "exit 0", NULL };
    execv(args[0], args);
  } else if (!strcmp(mode, "supervisor")) {
    syscall(SYS_kill, getppid(), 0);
  } else if (!strcmp(mode, "supervisor-proc")) {
    snprintf(path, sizeof(path), "/proc/%ld/root/etc/passwd", (long) getppid());
    syscall(SYS_openat, AT_FDCWD, path, O_RDONLY, 0);
  } else if (!strcmp(mode, "untraced-clone")) {
    syscall(SYS_clone, CLONE_UNTRACED | SIGCHLD, NULL, NULL, NULL, 0);
  } else if (!strcmp(mode, "io-uring")) {
#ifdef SYS_io_uring_setup
    char arguments[128] = { 0 };
    syscall(SYS_io_uring_setup, 1, arguments);
#else
    return 7;
#endif
  } else if (!strcmp(mode, "orphan")) {
    pid_t child = fork();
    if (child < 0) return 8;
    if (!child) { for (;;) usleep(10000); }
    return 0;
  } else if (!strcmp(mode, "output-limit")) {
    fd = open(output, O_WRONLY | O_CREAT, 0600);
    if (fd < 0) return 12;
    syscall(SYS_ftruncate, fd, 1073741825ULL);
  } else if (!strcmp(mode, "thread-race")) {
    pthread_t thread;
    snprintf(permitted_path, sizeof(permitted_path), "%s", output);
    if (!getcwd(path, sizeof(path))) return 9;
    if (strlen(path) + 12 > sizeof(forbidden_path)) return 13;
    strcpy(forbidden_path, path);
    strcat(forbidden_path, "/public.txt");
    memcpy(changing_path, permitted_path, strlen(permitted_path) + 1);
    atomic_store(&changing, 1);
    if (pthread_create(&thread, NULL, change_path, NULL)) return 10;
    for (size_t i = 0; i < 500; i++) {
      usleep(100);
      fd = (int) syscall(SYS_openat, AT_FDCWD, changing_path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
      if (fd >= 0) { write(fd, "race", 4); close(fd); }
    }
    atomic_store(&changing, 0);
    pthread_join(thread, NULL);
    return 0;
  } else return 11;
  /* A caught errno and an otherwise successful exit cannot forge acceptance. */
  return 0;
}
`;

// This in-process scheduler harness stubs ptrace. It checks fixed event
// interleavings, never counts as traced native execution or renderer evidence.
const schedulingHarnessSource = String.raw`
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/ptrace.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <assert.h>

_Alignas(sizeof(long)) static char denied_path[4096];
static unsigned resume_attempts, syscall_resumes, interrupt_attempts;
static pid_t last_resumed;
static int interrupt_errno, observed_available;
static long scheduling_test_ptrace(enum __ptrace_request request, ...);
#define ptrace scheduling_test_ptrace
#define main scheduling_test_supervisor_main
#include "supervisor.c"
#undef main
#undef ptrace

static struct np_syscall_info observed_call;
static long scheduling_test_ptrace(enum __ptrace_request request, ...) {
  va_list args;
  pid_t pid;
  void *address, *data;
  long word;
  va_start(args, request);
  pid = va_arg(args, pid_t);
  address = va_arg(args, void *);
  data = va_arg(args, void *);
  va_end(args);
  if (request == PTRACE_PEEKDATA) {
    uintptr_t start = (uintptr_t) denied_path, current = (uintptr_t) address;
    if (current < start || current > start + sizeof(denied_path) - sizeof(word)) {
      errno = EFAULT; return -1;
    }
    memcpy(&word, address, sizeof(word));
    return word;
  }
  if (request == PTRACE_GET_SYSCALL_INFO && observed_available) {
    assert((uintptr_t) address == sizeof(observed_call));
    memcpy(data, &observed_call, sizeof(observed_call));
    return sizeof(observed_call);
  }
  if (request == PTRACE_SYSCALL) {
    resume_attempts++; syscall_resumes++; last_resumed = pid;
    return 0;
  }
  if (request == PTRACE_INTERRUPT) {
    resume_attempts++; interrupt_attempts++;
    if (interrupt_errno) { errno = interrupt_errno; return -1; }
    return 0;
  }
  errno = ESRCH;
  return -1;
}

static void reset_case(void) {
  memset(tasks, 0, sizeof(tasks));
  used_tasks = live_tasks = 2;
  reaped_tasks = terminal_waits = 0;
  exclusive_pid = 0;
  failed = violation = 0;
  reason = "none";
  resume_attempts = syscall_resumes = interrupt_attempts = 0;
  last_resumed = 0;
  interrupt_errno = observed_available = 0;
  memset(&observed_call, 0, sizeof(observed_call));
  root_reaped = root_exit = root_signal = 0;
  syscall_count = bookkeeping_writes = 0;
  blocking_write_interrupts = blocking_write_yields = 0;
  supervisor_pid = 9999;
  root_pid = 11;
  for (size_t i = 0; i < 2; i++) {
    tasks[i].pid = i ? 22 : 11;
    tasks[i].alive = tasks[i].stopped = tasks[i].creation_seen = 1;
    tasks[i].call.arch = NP_AUDIT_ARCH;
  }
}
static void entry(struct np_task *task, uint64_t nr) {
  task->inspect = 1;
  task->call.op = PTRACE_SYSCALL_INFO_ENTRY;
  task->call.data.entry.nr = nr;
}
static void denied_write(void) {
  entry(&tasks[1], SYS_openat);
  tasks[1].call.data.entry.args[0] = (uint64_t) (int64_t) AT_FDCWD;
  tasks[1].call.data.entry.args[1] = (uintptr_t) denied_path;
  tasks[1].call.data.entry.args[2] = O_WRONLY;
}
static void assert_policy_before_resume(const char *expected) {
  schedule();
  assert(failed && violation && !strcmp(reason, expected));
  assert(resume_attempts == 0);
}
int main(int argc, char **argv) {
  assert(argc == 2);
  assert(snprintf(denied_path, sizeof(denied_path), "%s/public.txt", argv[1]) < (int) sizeof(denied_path));
  assert(snprintf(project_root, sizeof(project_root), "%s", argv[1]) < (int) sizeof(project_root));
  strcpy(output_root, "/np/output");

  reset_case();
  entry(&tasks[0], SYS_exit_group);
  denied_write();
  assert_policy_before_resume("write-outside-output");

  reset_case();
  tasks[0].signal = SIGTERM;
  denied_write();
  assert_policy_before_resume("write-outside-output");

  reset_case();
  tasks[0].exiting = 1;
  denied_write();
  assert_policy_before_resume("write-outside-output");

  reset_case();
  entry(&tasks[0], SYS_exit_group);
  entry(&tasks[1], SYS_kill);
  tasks[1].call.data.entry.args[0] = (uint64_t) supervisor_pid;
  assert_policy_before_resume("external-process-signal");

  reset_case();
  denied_write();
  observe(22, (PTRACE_EVENT_EXIT << 16) | (SIGTRAP << 8) | 0x7f);
  assert(failed && !strcmp(reason, "syscall-entry-unverifiable") && resume_attempts == 0);

  reset_case();
  tasks[1].pending_socket = 1;
  observe(22, 0);
  assert(failed && !strcmp(reason, "syscall-exit-unverifiable"));
  assert(!tasks[1].alive && reaped_tasks == 1 && resume_attempts == 0);

  reset_case();
  observe(22, ((SIGTRAP | 0x80) << 8) | 0x7f);
  assert(failed && !strcmp(reason, "syscall-observation-vanished") && resume_attempts == 0);
  observe(22, 0);
  assert(failed && !strcmp(reason, "syscall-observation-vanished"));
  assert(!tasks[1].alive && reaped_tasks == 1);

  /* Request and EVENT_STOP retain the inspected writer's exclusive ownership. */
  reset_case();
  exclusive_pid = 11;
  tasks[0].stopped = 0;
  tasks[0].call.op = PTRACE_SYSCALL_INFO_ENTRY;
  tasks[0].call.data.entry.nr = SYS_write;
  tasks[0].write_resumed_ms = now_ms() - 100;
  schedule();
  assert(!failed && interrupt_attempts == 1 && syscall_resumes == 0);
  assert(exclusive_pid == 11 && tasks[0].write_interrupt_requested && tasks[1].stopped);
  assert(blocking_write_interrupts == 1 && blocking_write_yields == 0);
  observe(11, (PTRACE_EVENT_STOP << 16) | (SIGTRAP << 8) | 0x7f);
  assert(!failed && exclusive_pid == 11 && tasks[0].write_interrupt_requested);
  schedule();
  assert(!failed && syscall_resumes == 1 && last_resumed == 11 && tasks[1].stopped);
  assert(exclusive_pid == 11 && tasks[0].write_interrupt_requested && !tasks[0].write_yield_until_ms);

  /* Reconcile every actual EXIT effect before clearing the interrupt flag. */
  reset_case();
  exclusive_pid = 11;
  tasks[0].write_interrupt_requested = 1;
  tasks[0].failure_only_probe = 1;
  observed_available = 1;
  observed_call.op = PTRACE_SYSCALL_INFO_EXIT;
  observed_call.arch = NP_AUDIT_ARCH;
  observed_call.data.exit.rval = 0;
  observe(11, ((SIGTRAP | 0x80) << 8) | 0x7f);
  assert(failed && !strcmp(reason, "runtime-probe-succeeded"));
  assert(exclusive_pid == 11 && tasks[0].write_interrupt_requested && !tasks[0].write_yield_until_ms);
  assert(blocking_write_yields == 0 && resume_attempts == 0);

  /* Actual EXIT alone establishes a bounded stopped hold. A reader can
   * advance, then the restarted writer ENTRY receives a fresh policy check. */
  reset_case();
  exclusive_pid = 11;
  tasks[0].write_interrupt_requested = 1;
  tasks[0].bookkeeping_write_length = 1;
  observed_available = 1;
  observed_call.op = PTRACE_SYSCALL_INFO_EXIT;
  observed_call.arch = NP_AUDIT_ARCH;
  observed_call.data.exit.rval = 1;
  observe(11, ((SIGTRAP | 0x80) << 8) | 0x7f);
  assert(!failed && !exclusive_pid && !tasks[0].write_interrupt_requested);
  assert(bookkeeping_writes == 1 && !tasks[0].bookkeeping_write_length && blocking_write_yields == 1);
  assert(tasks[0].write_yield_until_ms > now_ms());
  schedule();
  assert(!failed && tasks[0].stopped && !tasks[1].stopped && syscall_resumes == 1 && last_resumed == 22);
  tasks[0].write_yield_until_ms = now_ms() - 1;
  assert(resume_task(&tasks[0]) && !tasks[0].stopped && syscall_resumes == 2 && last_resumed == 11);
  observed_call.op = PTRACE_SYSCALL_INFO_ENTRY;
  observed_call.data.entry.nr = SYS_openat;
  observed_call.data.entry.args[0] = (uint64_t) (int64_t) AT_FDCWD;
  observed_call.data.entry.args[1] = (uintptr_t) denied_path;
  observed_call.data.entry.args[2] = O_WRONLY;
  observe(11, ((SIGTRAP | 0x80) << 8) | 0x7f);
  tasks[1].stopped = 1;
  schedule();
  assert(failed && violation && !strcmp(reason, "write-outside-output") && syscall_resumes == 2);

  reset_case();
  exclusive_pid = 11;
  tasks[0].write_interrupt_requested = 1;
  observed_available = 1;
  observed_call.op = PTRACE_SYSCALL_INFO_ENTRY;
  observed_call.arch = NP_AUDIT_ARCH;
  observed_call.data.entry.nr = SYS_write;
  observe(11, ((SIGTRAP | 0x80) << 8) | 0x7f);
  assert(failed && !strcmp(reason, "syscall-exit-unverifiable") && exclusive_pid == 11);
  assert(tasks[0].write_interrupt_requested && !tasks[0].write_yield_until_ms && resume_attempts == 0);

  reset_case();
  tasks[1].write_interrupt_requested = 1;
  observe(22, 0);
  assert(failed && !strcmp(reason, "syscall-exit-unverifiable"));
  assert(!tasks[1].alive && reaped_tasks == 1 && blocking_write_yields == 0 && resume_attempts == 0);

  reset_case();
  exclusive_pid = 22;
  tasks[1].write_interrupt_requested = 1;
  observe(22, (PTRACE_EVENT_EXIT << 16) | (SIGTRAP << 8) | 0x7f);
  assert(failed && !strcmp(reason, "syscall-exit-unverifiable") && exclusive_pid == 22);
  assert(tasks[1].alive && blocking_write_yields == 0 && resume_attempts == 0);

  reset_case();
  exclusive_pid = 22;
  tasks[1].write_interrupt_requested = 1;
  observe(22, ((SIGTRAP | 0x80) << 8) | 0x7f);
  assert(failed && !strcmp(reason, "syscall-observation-vanished") && exclusive_pid == 22);
  assert(tasks[1].write_interrupt_requested && !tasks[1].write_yield_until_ms && resume_attempts == 0);

  /* ESRCH on the request does not release the still-unobserved writer. */
  reset_case();
  exclusive_pid = 11;
  tasks[0].stopped = 0;
  tasks[0].write_resumed_ms = now_ms() - 100;
  interrupt_errno = ESRCH;
  schedule();
  assert(!failed && exclusive_pid == 11 && tasks[1].stopped && syscall_resumes == 0);
  assert(interrupt_attempts == 1 && !tasks[0].write_interrupt_requested && blocking_write_yields == 0);
  observe(11, ((SIGTRAP | 0x80) << 8) | 0x7f);
  assert(failed && !strcmp(reason, "syscall-observation-vanished") && exclusive_pid == 11);

  puts("{\"scope\":\"scheduler-interleaving-unit-harness\",\"cases\":15,\"status\":\"passed\"}");
  return 0;
}
`;

const fatalExitModes = [
  ["fatal-group-sigkill", 289],
  ["fatal-group-sigterm", 289],
  ["fatal-group-sigpipe", 289],
  ["fatal-group-sigabrt", 289],
  ["fatal-parent-exit-pdeath", 321],
  ["fatal-parent-exit-group-pdeath", 321],
  ["fatal-parent-self-kill-pdeath", 321],
] as const;

const nextEnvironmentModes = [
  ["next-positive", "passed", 1],
  ["next-four", "passed", 4],
  ["next-cap", "passed", 16],
  ["next-cap-overflow", "violation", 16],
  ["next-file", "violation", 0],
  ["next-symlink", "violation", 0],
  ["next-hardlink", "violation", 0],
  ["next-parent-symlink", "violation", 0],
  ["next-server-symlink", "violation", 0],
  ["next-server-hardlink", "violation", 0],
  ["next-parent-cas", "violation", 1],
  ["next-source-rw", "violation", 0],
  ["next-foreign-role", "violation", 0],
  ["next-chromium-role", "violation", 0],
  ["next-postgres-role", "violation", 0],
  ["next-null-buffer", "violation", 0],
  ["next-dirfd-high", "violation", 0],
  ["next-extra-argv", "violation", 0],
  ["next-wrong-clock", "violation", 0],
  ["next-alternate", "violation", 0],
  ["next-relative", "violation", 0],
  ["next-flags", "violation", 0],
  ["next-mask", "violation", 0],
  ["next-extra-register", "violation", 0],
  ["next-dirfd", "violation", 0],
  ["next-open", "violation", 0],
  ["next-read", "violation", 0],
  ["next-write", "violation", 0],
  ["next-access", "violation", 0],
  ["next-readlink", "violation", 0],
  ["next-fstatat", "violation", 0],
  ["next-thread-race", "violation", -1],
] as const;

// This separate image deliberately installs the synthetic fixture at the Node
// path. It is never an accepted renderer image. Each case needs a fresh private
// PID/IPC namespace and an actually readonly /np/project bind, so a direct local
// runner cannot stand in for this profile. Set this exact immutable fixture ID
// only after compiling the two fixed sources in the dedicated test image.
const nextFixtureImage = process.env.NP_TEST_SITE_BUILD_LINUX_NEXT_FIXTURE_IMAGE;
describe.runIf(nextFixtureImage !== undefined)("closed Next absent-metadata profile", () => {
  it("returns only bounded ENOENT and preserves the credential guard", async () => {
    if (!nextFixtureImage || !/^sha256:[a-f0-9]{64}$/u.test(nextFixtureImage))
      throw new Error("fixed-next-fixture-image-required");
    const binding = await execute(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "16",
        "--memory",
        "64m",
        "--entrypoint",
        "/usr/bin/sha256sum",
        nextFixtureImage,
        "/opt/np/native/supervisor-clean.c",
        "/opt/np/native/fixture-next.c",
      ],
      { timeout: 15_000, maxBuffer: 4096 },
    );
    const hashes = binding.stdout
      .trim()
      .split("\n")
      .map((line) => line.split(" ")[0]);
    expect(hashes).toEqual([
      createHash("sha256").update(NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1).digest("hex"),
      createHash("sha256").update(fixtureSource).digest("hex"),
    ]);
    const root = await mkdtemp(join(tmpdir(), "np-next-profile-test-"));
    try {
      for (const [mode, status, count] of nextEnvironmentModes) {
        const project = join(root, mode),
          standalone = join(project, ".next/standalone");
        await mkdir(standalone, { recursive: true });
        await writeFile(join(project, "input.txt"), `${mode}\n`);
        await writeFile(join(standalone, "server.js"), `${mode}\n`);
        if (mode === "next-file")
          await writeFile(join(standalone, ".env.production.local"), "synthetic");
        if (mode === "next-symlink")
          await symlink("absent", join(standalone, ".env.production.local"));
        if (mode === "next-hardlink")
          await link(join(project, "input.txt"), join(standalone, ".env.production.local"));
        if (mode === "next-server-symlink") {
          await rm(join(standalone, "server.js"));
          await symlink("../../input.txt", join(standalone, "server.js"));
        }
        if (mode === "next-server-hardlink") {
          await rm(join(standalone, "server.js"));
          await link(join(project, "input.txt"), join(standalone, "server.js"));
        }
        if (mode === "next-parent-symlink") {
          await rename(standalone, join(project, "standalone-real"));
          await symlink("../standalone-real", standalone);
        }
        if (mode === "next-thread-race")
          await writeFile(join(standalone, ".env.secret"), "synthetic-never-read");
        const executable =
          mode === "next-chromium-role"
            ? "/opt/np/chromium/chrome-headless-shell"
            : mode === "next-postgres-role"
              ? "/usr/lib/postgresql/16/bin/postgres"
              : "/usr/local/bin/node";
        const name = `np-next-profile-${randomUUID()}`;
        const args = [
          "run",
          "--name",
          name,
          "--network",
          "none",
          "--ipc",
          "private",
          "--read-only",
          "--pids-limit",
          "64",
          "--memory",
          "256m",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "SYS_PTRACE",
          "--cap-add",
          "SETUID",
          "--cap-add",
          "SETGID",
          "--cap-add",
          "KILL",
          "--security-opt",
          "no-new-privileges",
          "--mount",
          `type=bind,src=${project},dst=/np/project${mode === "next-source-rw" ? "" : ",readonly"}`,
          "--tmpfs",
          "/np/output:rw,nosuid,nodev,size=32m,nr_inodes=1024,uid=1000,gid=1000,mode=755",
          "--tmpfs",
          "/np/audit:rw,nosuid,nodev,size=1m,nr_inodes=32,mode=700",
          "--entrypoint",
          "/opt/np/native/supervisor",
          nextFixtureImage,
          "/np/project",
          "/np/output",
          executable,
          "/np/project/input.txt",
          "18080",
          "15432",
          "/np/audit/result.json",
        ];
        let replacement: Promise<void> | undefined;
        if (mode === "next-parent-cas")
          replacement = new Promise<void>((resolve, reject) =>
            setTimeout(() => {
              void (async () => {
                await rename(standalone, join(project, "old-standalone"));
                await mkdir(standalone);
                await writeFile(join(standalone, "server.js"), `${mode}\n`);
              })().then(resolve, reject);
            }, 1000),
          );
        let result: { stdout: string; stderr: string };
        try {
          try {
            result = await execute("docker", args, { timeout: 15_000, maxBuffer: 4096 });
          } catch (error) {
            if (
              error === null ||
              typeof error !== "object" ||
              !("stdout" in error) ||
              !("stderr" in error) ||
              typeof error.stdout !== "string" ||
              typeof error.stderr !== "string"
            )
              throw error;
            result = { stdout: error.stdout, stderr: error.stderr };
          }
          await replacement;
          const audit: Record<string, unknown> = JSON.parse(result.stdout);
          expect(audit.status, mode).toBe(status);
          expect(audit.reason, mode).toBe(status === "passed" ? "none" : "credential-access");
          expect(audit.argumentsFrozen, mode).toBe(true);
          expect(audit.descendantsReaped, mode).toBe(true);
          expect(audit.ownIpcReclaimed, mode).toBe(true);
          expect(audit.tracedProcesses, mode).toBe(audit.reapedProcesses);
          if (count >= 0) expect(audit.blockedNextEnvMetadata, mode).toBe(count);
          else {
            expect(audit.peakTracees).toBeGreaterThanOrEqual(2);
            expect(Number(audit.blockedNextEnvMetadata)).toBeLessThanOrEqual(16);
          }
          expect(audit.forbiddenAttempts, mode).toBe(status === "passed" ? 0 : 1);
          expect(result.stderr, mode).toBe("");
        } finally {
          await replacement;
          await execute("docker", ["rm", "-fv", name]);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});

// This image contains only a fixed synthetic C program at the registered binary
// paths. It is never renderer execution or real Node/Chromium/PostgreSQL proof.
// Its source hashes must match this checkout before any diagnostic is asserted.
const diagnosticFixtureImage = process.env.NP_TEST_SITE_BUILD_LINUX_WRITE_DIAGNOSTICS_IMAGE;
describe.runIf(diagnosticFixtureImage !== undefined)("resolved blocked-write diagnostics", () => {
  it("observes closed enums without changing write policy or earlier deny priority", async () => {
    if (!diagnosticFixtureImage || !/^sha256:[a-f0-9]{64}$/u.test(diagnosticFixtureImage))
      throw new Error("fixed-write-diagnostics-fixture-image-required");
    await withSiteBuildDockerV1(async (host) => {
      const binding = await runSiteBuildDockerV1(
        host,
        [
          "run",
          "--rm",
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "16",
          "--memory",
          "64m",
          "--entrypoint",
          "/usr/bin/sha256sum",
          ...siteBuildReadOnlyImageDataArgsV1(host),
          diagnosticFixtureImage,
          "/opt/np/native/supervisor-clean.c",
          "/opt/np/native/fixture-next.c",
        ],
        { timeoutMs: 15_000, bytes: 4096 },
      );
      expect(binding.code).toBe(0);
      expect(binding.stderr.length).toBe(0);
      expect(
        binding.stdout
          .toString("utf8")
          .trim()
          .split("\n")
          .map((line) => line.split(" ")[0]),
      ).toEqual([
        createHash("sha256").update(NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1).digest("hex"),
        createHash("sha256").update(fixtureSource).digest("hex"),
      ]);
      const cases = [
        ["project", "project-root", "directory"],
        ["source", "project-source", "absent"],
        ["dependencies", "project-dependencies", "directory"],
        ["dependencies-boundary", "project-source", "absent"],
        ["next", "next-root", "directory"],
        ["next-cache", "next-cache", "absent"],
        ["next-server", "next-server", "absent"],
        ["next-server-file", "next-server", "file"],
        ["next-server-link", "next-server", "file"],
        ["next-server-boundary", "next-root", "absent"],
        ["standalone", "standalone-root", "directory"],
        ["standalone-next", "standalone-next-root", "directory"],
        ["standalone-cache", "standalone-next-cache", "absent"],
        ["standalone-server", "standalone-next-server", "absent"],
        ["standalone-server-boundary", "standalone-next-root", "absent"],
        ["proc", "proc", "file"],
        ["sys", "sys", "directory"],
        ["dev", "dev", "other"],
        ["tmp", "tmp", "directory"],
        ["tmp-boundary", "other", "absent"],
        ["run", "run", "directory"],
        ["image", "image", "directory"],
        ["other", "other", "absent"],
        ["output", "unresolved", "unverifiable", "none"],
        ["cache-output", "unresolved", "unverifiable", "none"],
        ["credential", "unresolved", "unverifiable", "credential-access"],
        ["unresolved", "unresolved", "unverifiable", "path-unverifiable"],
        ["supervisor", "unresolved", "unverifiable", "supervisor-access"],
      ] as const;
      const executions = [
        ...cases.map(([mode, target, state, reason = "write-outside-output"]) => ({
          mode,
          target,
          state,
          reason,
          executable: "/usr/local/bin/node",
          actor: "node",
        })),
        ...[
          ["/opt/np/chromium/chrome", "chromium"],
          ["/opt/np/chromium/chrome-headless-shell", "chromium"],
          ["/opt/np/chromium/chrome_crashpad_handler", "chromium"],
          ["/opt/np/chromium/chrome_sandbox", "chromium"],
          ["/usr/lib/postgresql/16/bin/postgres", "postgres"],
          ["/opt/np/native/fixture", "other"],
        ].map(([executable, actor]) => ({
          mode: "source",
          target: "project-source",
          state: "absent",
          reason: "write-outside-output",
          executable,
          actor,
        })),
      ];
      const root = await mkdtemp(join(tmpdir(), "np-write-diagnostics-test-"));
      try {
        for (const [index, entry] of executions.entries()) {
          const project = join(root, String(index));
          for (const directory of [
            "node_modules",
            ".next/cache",
            ".next/server",
            ".next/standalone/.next/cache",
            ".next/standalone/.next/server",
          ])
            await mkdir(join(project, directory), { recursive: true });
          await writeFile(join(project, "input.txt"), `diagnostic-${entry.mode}\n`);
          await writeFile(join(project, ".next/server/existing"), "synthetic");
          await symlink(".next/server/existing", join(project, "server-link"));
          await symlink("/np/output", join(project, ".next/cache-output"));
          const name = `np-write-diagnostics-${randomUUID()}`;
          try {
            const result = await runSiteBuildDockerV1(
              host,
              [
                "run",
                "--name",
                name,
                "--network",
                "none",
                "--ipc",
                "private",
                "--read-only",
                "--pids-limit",
                "64",
                "--memory",
                "256m",
                "--cap-drop",
                "ALL",
                "--cap-add",
                "SYS_PTRACE",
                "--cap-add",
                "SETUID",
                "--cap-add",
                "SETGID",
                "--cap-add",
                "KILL",
                "--security-opt",
                "no-new-privileges",
                "--mount",
                `type=bind,src=${project},dst=/np/project,readonly`,
                "--tmpfs",
                "/np/output:rw,nosuid,nodev,size=32m,nr_inodes=1024,uid=1000,gid=1000,mode=755",
                "--tmpfs",
                "/np/audit:rw,nosuid,nodev,size=1m,nr_inodes=32,mode=700",
                "--entrypoint",
                "/opt/np/native/supervisor",
                ...siteBuildReadOnlyImageDataArgsV1(host),
                diagnosticFixtureImage,
                "/np/project",
                "/np/output",
                entry.executable,
                "/np/project/input.txt",
                "18080",
                "15432",
                "/np/audit/result.json",
              ],
              { timeoutMs: 15_000, bytes: 4096 },
            );
            const audit: Record<string, unknown> = JSON.parse(result.stdout.toString("utf8"));
            const writing = entry.reason === "write-outside-output";
            expect(result.code, entry.mode).toBe(entry.reason === "none" ? 0 : 71);
            expect(result.stderr.length, entry.mode).toBe(0);
            expect(audit.reason, entry.mode).toBe(entry.reason);
            expect(audit.status, entry.mode).toBe(entry.reason === "none" ? "passed" : "violation");
            expect(audit.blockedWriteActor, entry.mode).toBe(writing ? entry.actor : "other");
            expect(audit.blockedWriteTarget, entry.mode).toBe(entry.target);
            expect(audit.blockedWriteTargetState, entry.mode).toBe(entry.state);
            expect(audit.forbiddenAttempts, entry.mode).toBe(entry.reason === "none" ? 0 : 1);
            expect(audit.blockedSyscall, entry.mode).toBe(
              entry.reason === "none" ? -1 : audit.platform === "linux-aarch64" ? 34 : 258,
            );
            expect(audit.descendantsReaped, entry.mode).toBe(true);
            expect(audit.ownIpcReclaimed, entry.mode).toBe(true);
            expect(audit.tracedProcesses, entry.mode).toBe(audit.reapedProcesses);
            expect(audit.argumentsFrozen, entry.mode).toBe(true);
            expect(result.stdout.toString("utf8"), entry.mode).not.toMatch(
              /\/np\/|\/proc\/|diagnostic-/u,
            );
          } finally {
            await runSiteBuildDockerV1(host, ["rm", "-f", name], {
              timeoutMs: 10_000,
              bytes: 4096,
            });
          }
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }, 180_000);
});

describe.runIf(nativeEnabled)("fixed Linux native renderer supervisor", () => {
  it("keeps policy observations and blocking-write ownership until actual reconciled syscall exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "np-supervisor-scheduling-")),
      source = join(root, "supervisor.c"),
      harnessSource = join(root, "scheduling-harness.c"),
      harness = join(root, "scheduling-harness"),
      project = join(root, "project");
    try {
      await mkdir(project);
      await writeFile(join(project, "public.txt"), "preserved");
      await writeFile(source, NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1);
      await writeFile(harnessSource, schedulingHarnessSource);
      await execute(
        "cc",
        ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", harnessSource, "-o", harness],
        { timeout: 10_000, maxBuffer: 4096 },
      );
      const result = await execute(harness, [project], {
        env: {},
        timeout: 2000,
        maxBuffer: 4096,
      });
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        scope: "scheduler-interleaving-unit-harness",
        cases: 15,
        status: "passed",
      });
      expect(await readFile(join(project, "public.txt"), "utf8")).toBe("preserved");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("allows the bounded normal child tree and sticky-blocks direct forbidden syscalls", async () => {
    const root = await mkdtemp(join(tmpdir(), "np-linux-supervisor-"));
    const source = join(root, "supervisor.c"),
      runner = join(root, "supervisor"),
      fixture = join(root, "fixture"),
      fixtureC = join(root, "fixture.c");
    try {
      await chmod(root, 0o755);
      await writeFile(source, NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1);
      await writeFile(fixtureC, fixtureSource);
      await execute("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", source, "-o", runner]);
      await execute("cc", [
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pthread",
        fixtureC,
        "-o",
        fixture,
      ]);
      const modes = [
        ["ok", "passed", "none"],
        ["group-exit-clean", "passed", "none"],
        ["group-exit-tgkill", "passed", "none"],
        ["group-exit-kill", "passed", "none"],
        ["group-exit-race", "passed", "none"],
        ["group-exit-leader-first", "passed", "none"],
        ...fatalExitModes.map(([mode]) => [mode, "passed", "none"] as const),
        ["sigchld-restart-read", "passed", "none"],
        ["blocking-pipe-write", "passed", "none"],
        ["blocking-pipe-writev", "passed", "none"],
        ["blocking-unix-write", "passed", "none"],
        ["blocking-unix-writev", "passed", "none"],
        ["blocking-unix-sendto", "passed", "none"],
        ["blocking-unix-sendmsg", "passed", "none"],
        ["blocking-unix-sendmmsg", "passed", "none"],
        ["flush-role", "violation", "file-sync-role"],
        ["advice-role", "violation", "file-advice-role"],
        ["pg-shm-role", "violation", "sysv-ipc-role"],
        ["dangling", "passed", "none"],
        ["empty-negative", "passed", "none"],
        ["retired-stat", "passed", "none"],
        ["retired-stat-write", "violation", "write-outside-output"],
        ["nscd-unregistered", "violation", "write-outside-output"],
        ["metadata-empty", "passed", "none"],
        ["group", "passed", "none"],
        ["securebits-get", "passed", "none"],
        ["ambient-get", "passed", "none"],
        ["ambient-raise", "violation", "process-control-unavailable"],
        ["ambient-invalid", "violation", "process-control-unavailable"],
        ["ambient-extra", "violation", "process-control-unavailable"],
        ["securebits-set", "violation", "process-control-unavailable"],
        ["securebits-extra", "violation", "process-control-unavailable"],
        ["retired-zombie", "passed", "none"],
        ["retired-zombie-group", "passed", "none"],
        ["ambient-group", "violation", "external-process-signal"],
        ["credential-link", "violation", "credential-access"],
        ["credential", "violation", "credential-access"],
        ["write", "violation", "write-outside-output"],
        ["shared-map-write", "violation", "write-outside-output"],
        ["egress", "violation", "network-outside-loopback"],
        ["unbound-listen", "violation", "implicit-network-bind"],
        ["sendto", "violation", "network-outside-loopback"],
        ["exec", "violation", "unregistered-executable"],
        ["supervisor", "violation", "external-process-signal"],
        ["supervisor-proc", "violation", "supervisor-access"],
        ["untraced-clone", "violation", "process-escape"],
        ["io-uring", "violation", "asynchronous-memory-operation"],
        ["orphan", "failed", "orphan-descendant"],
        ["output-limit", "failed", "output-byte-limit"],
        ["thread-race", "violation", "write-outside-output"],
        ["oom-positive", "passed", "none"],
        ["oom-negative", "violation", "process-bookkeeping-unavailable"],
        ["oom-decrease", "violation", "process-priority-decrease"],
        ["oom-external", "violation", "supervisor-access"],
        ["oom-writev", "violation", "write-outside-output"],
        ["oom-mmap", "violation", "write-outside-output"],
        ["oom-truncate", "violation", "write-outside-output"],
        ["clear-unregistered", "violation", "write-outside-output"],
        ["clear-external", "violation", "supervisor-access"],
        ["udp-ipv4", "passed", "none"],
        ["udp-ipv6", "passed", "none"],
        ["route-read", "passed", "none"],
        ["route-mutate-sendto", "violation", "netlink-mutation"],
        ["route-mutate-write", "violation", "netlink-mutation"],
        ["route-mutate-writev", "violation", "netlink-mutation"],
        ["route-mutate-sendmsg", "violation", "netlink-mutation"],
        ["route-other-protocol", "violation", "socket-family-unavailable"],
        ["route-userspace-peer", "violation", "netlink-external-peer"],
        ["uevent-write", "violation", "read-only-channel-write"],
      ] as const;
      // The dedicated native fixture image compiles this exact synthetic
      // program at this registered path. Production Chromium is never replaced
      // or executed as a test fixture; an explicit opt-in and byte equality are
      // required before testing its narrow accounting/query profiles.
      const registeredFixture =
        process.env.NP_TEST_SITE_BUILD_LINUX_REGISTERED_FIXTURE === "1"
          ? "/opt/np/chromium/chrome-headless-shell"
          : undefined;
      const postgresFixture =
        process.env.NP_TEST_SITE_BUILD_LINUX_POSTGRES_FIXTURE === "1"
          ? "/usr/lib/postgresql/16/bin/postgres"
          : undefined;
      const postgresModes = [
        ["flush-positive", "passed", "none"],
        ["flush-source", "violation", "file-sync-target"],
        ["flush-directory", "violation", "file-sync-target"],
        ["flush-memfd", "violation", "file-sync-target"],
        ["flush-other", "violation", "file-sync-shape"],
        ["flush-negative", "violation", "file-sync-shape"],
        ["flush-zero", "violation", "file-sync-shape"],
        ["flush-large", "violation", "file-sync-shape"],
        ["flush-overflow", "violation", "file-sync-shape"],
        ["advice-positive", "passed", "none"],
        ["advice-source", "violation", "file-advice-target"],
        ["advice-directory", "violation", "file-advice-target"],
        ["advice-memfd", "violation", "file-advice-target"],
        ["advice-other", "violation", "file-advice-shape"],
        ["advice-negative", "violation", "file-advice-shape"],
        ["advice-zero", "violation", "file-advice-shape"],
        ["advice-large", "violation", "file-advice-shape"],
        ["advice-overflow", "violation", "file-advice-shape"],
        ["pg-shm-positive", "passed", "none"],
        ["pg-shm-fork", "passed", "none"],
        ["pg-shm-rmid-attached", "passed", "none"],
        ["pg-shm-oversize", "violation", "sysv-ipc-shape"],
        ["pg-shm-flags", "violation", "sysv-ipc-shape"],
        ["pg-shm-huge", "violation", "sysv-ipc-shape"],
        ["pg-shm-lookup", "violation", "sysv-ipc-shape"],
        ["pg-shm-foreign-id", "violation", "sysv-ipc-foreign-id"],
        ["pg-shm-foreign-attach", "violation", "sysv-ipc-foreign-id"],
        ["pg-shm-permissions", "violation", "sysv-ipc-control"],
        ["pg-shm-attach-address", "violation", "sysv-ipc-shape"],
        ["pg-shm-attach-flags", "violation", "sysv-ipc-shape"],
        ["pg-shm-address", "violation", "sysv-ipc-foreign-address"],
        ["pg-shm-unrecorded-detach", "violation", "sysv-ipc-foreign-address"],
        ["pg-shm-leak", "failed", "sysv-ipc-cleanup"],
        ["pg-shm-terminated", "failed", "driver-exit"],
        ["pg-shm-limit", "failed", "sysv-ipc-limit"],
      ] as const;
      const registeredModes = [
        ["pg-shm-role", "violation", "sysv-ipc-role"],
        ["nscd-negative", "passed", "none"],
        ["clear-positive", "passed", "none"],
        ["clear-one", "violation", "process-bookkeeping-unavailable"],
        ["clear-zero", "violation", "process-bookkeeping-unavailable"],
        ["clear-newline", "violation", "process-bookkeeping-unavailable"],
        ["clear-writev", "violation", "write-outside-output"],
        ["clear-mmap", "violation", "write-outside-output"],
        ["clear-truncate", "violation", "write-outside-output"],
        ["clear-external", "violation", "supervisor-access"],
      ] as const;
      if (registeredFixture)
        expect(await readFile(registeredFixture)).toEqual(await readFile(fixture));
      if (postgresFixture) expect(await readFile(postgresFixture)).toEqual(await readFile(fixture));
      const cases = [
        ...modes.map(([mode, expectedStatus, expectedReason]) => ({
          mode,
          expectedStatus,
          expectedReason,
          executable: fixture,
        })),
        ...(postgresFixture
          ? postgresModes.map(([mode, expectedStatus, expectedReason]) => ({
              mode,
              expectedStatus,
              expectedReason,
              executable: postgresFixture,
            }))
          : []),
        ...(registeredFixture
          ? registeredModes.map(([mode, expectedStatus, expectedReason]) => ({
              mode,
              expectedStatus,
              expectedReason,
              executable: registeredFixture,
            }))
          : []),
      ];
      const fixtureIpcRows = async () => {
        const lines = (await readFile("/proc/sysvipc/shm", "utf8")).trim().split("\n");
        expect(lines.length).toBeLessThanOrEqual(32);
        const rows = lines
          .slice(1)
          .map((line) => line.trim().split(/\s+/u))
          .filter((fields) => Number(fields[0]) >= 2367995 && Number(fields[0]) <= 2367999);
        expect(rows.length).toBeLessThanOrEqual(5);
        for (const fields of rows) {
          expect(fields.length).toBeGreaterThanOrEqual(11);
          expect(Number.isSafeInteger(Number(fields[1]))).toBe(true);
          expect(Number(fields[1])).toBeGreaterThanOrEqual(0);
          expect(fields[2]).toBe("600");
          expect(Number(fields[3])).toBe(56);
          expect(Number(fields[6])).toBe(0);
          expect(Number(fields[7])).toBe(1000);
          expect(Number(fields[8])).toBe(1000);
          expect(Number(fields[9])).toBe(1000);
          expect(Number(fields[10])).toBe(1000);
        }
        return rows.map((fields) => Number(fields[1]));
      };
      for (const [index, { mode, expectedStatus, expectedReason, executable }] of cases.entries()) {
        const runRoot = join(root, `${index}-${mode}`),
          project = join(runRoot, "project"),
          output = join(runRoot, "output"),
          audit = join(runRoot, "audit"),
          input = join(project, "input.txt"),
          auditFile = join(audit, "result.json");
        await mkdir(project, { recursive: true, mode: 0o755 });
        await mkdir(join(output, "tmp"), { recursive: true, mode: 0o755 });
        await mkdir(join(output, "home"), { mode: 0o755 });
        await mkdir(audit, { mode: 0o700 });
        await writeFile(join(project, "public.txt"), "preserved");
        await writeFile(input, `${mode}\n`);
        await symlink(".env.absent", join(project, "credential-link"));
        await chmod(output, 0o777);
        await chmod(join(output, "tmp"), 0o777);
        await chmod(join(output, "home"), 0o777);
        // Make the source writable by the tracee in this adversarial fixture.
        // The native audit must stop the call before kernel filesystem policy
        // is needed; production additionally mounts the project read-only.
        await chmod(join(project, "public.txt"), 0o666);
        const child = spawn(
          runner,
          [project, output, executable, input, "18080", "15432", auditFile],
          {
            env: {},
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (bytes: Buffer) => {
          stdout += bytes.toString();
          if (stdout.length > 4096) child.kill("SIGKILL");
        });
        child.stderr.on("data", (bytes: Buffer) => {
          stderr += bytes.toString();
          if (stderr.length > 4096) child.kill("SIGKILL");
        });
        const deadline = setTimeout(() => child.kill("SIGKILL"), 15_000);
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code, signal) => resolve({ code, signal }));
          },
        ).finally(() => clearTimeout(deadline));
        expect(exit.signal, `${mode}: ${stderr}`).toBeNull();
        const receipt: Record<string, unknown> = JSON.parse(stdout);
        expect(receipt.status, mode).toBe(expectedStatus);
        expect(receipt.reason, mode).toBe(expectedReason);
        expect(receipt.argumentsFrozen, mode).toBe(true);
        expect(receipt.descendantsReaped, mode).toBe(true);
        expect(receipt.reapedProcesses, mode).toBe(receipt.tracedProcesses);
        expect(await readFile(auditFile, "utf8"), mode).toBe(stdout);
        expect(await readFile(join(project, "public.txt"), "utf8"), mode).toBe("preserved");
        expect(stdout, mode).not.toContain(root);
        expect(exit.code, mode).toBe(
          expectedStatus === "passed" ? 0 : expectedStatus === "violation" ? 71 : 70,
        );
        if (mode === "ok") {
          // The result owner reads its private bytes; the parent has no DAC override capability.
          const result = await execute(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              "import{readFile}from'node:fs/promises';process.stdout.write(await readFile(process.argv[1]));",
              join(output, "result.txt"),
            ],
            { env: {}, uid: 1000, gid: 1000, timeout: 2000, maxBuffer: 4 },
          );
          expect(result.stdout).toBe("safe");
          expect(result.stderr).toBe("");
          expect(receipt.tracedProcesses).toBeGreaterThanOrEqual(2);
        }
        if (mode === "thread-race") expect(receipt.peakTracees).toBeGreaterThanOrEqual(2);
        if (mode === "group-exit-race") expect(receipt.tracedProcesses).toBeGreaterThanOrEqual(289);
        if (mode === "group-exit-leader-first")
          expect(receipt.tracedProcesses).toBeGreaterThanOrEqual(17);
        const fatalExit = fatalExitModes.find(([name]) => name === mode);
        if (fatalExit) {
          // Each case completes 32 rounds with eight live victim threads.
          // The common assertions above require exact saved/stdout audit
          // equality, successful exit and every observed task actually reaped.
          expect(receipt.tracedProcesses, mode).toBeGreaterThanOrEqual(fatalExit[1]);
          expect(receipt.forbiddenAttempts, mode).toBe(0);
        }
        if (mode === "sigchld-restart-read") {
          expect(receipt.tracedProcesses, mode).toBeGreaterThanOrEqual(3);
          expect(receipt.forbiddenAttempts, mode).toBe(0);
        }
        if (mode === "udp-ipv4") expect(receipt.blockedIpv4Datagrams).toBe(1);
        if (mode === "udp-ipv6") expect(receipt.blockedIpv6Datagrams).toBe(1);
        if (mode === "empty-negative") expect(receipt.blockedEmptyMetadata).toBe(1);
        if (mode === "nscd-negative") expect(receipt.blockedNscdProbes).toBe(1);
        if (mode === "clear-positive") expect(receipt.clearRefsWrites).toBe(1);
        if (expectedStatus === "passed") expect(receipt.ownIpcReclaimed).toBe(true);
        if (["pg-shm-leak", "pg-shm-terminated", "pg-shm-limit"].includes(mode))
          expect(receipt.ownIpcReclaimed).toBe(false);
        if (mode === "pg-shm-limit") expect(receipt.sysvShmChargedBytes).toBe(224);
        // Production discards each job's private IPC namespace. This harness
        // shares one namespace, so remove only its exact fixture-owned segments
        // after preserving every audit assertion and proving all tracees reaped.
        const segments = await fixtureIpcRows();
        if (receipt.ownIpcReclaimed === true) expect(segments, mode).toHaveLength(0);
        for (const id of segments) {
          const removed = await execute("/usr/bin/ipcrm", ["--shmem-id", String(id)], {
            env: {},
            uid: 1000,
            gid: 1000,
            timeout: 2000,
            maxBuffer: 1024,
          });
          expect(removed.stdout, mode).toBe("");
          expect(removed.stderr, mode).toBe("");
        }
        expect(await fixtureIpcRows(), mode).toHaveLength(0);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
