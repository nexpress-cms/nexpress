/**
 * Image-owned Linux runner. This source is compiled while the fixed renderer
 * image is provisioned; neither project input nor a proposal supplies C or argv.
 *
 * This is one layer of the renderer boundary, not a standalone sandbox. The
 * image must also have private PID/IPC/network namespaces, a read-only root and
 * project, no external writable/shared mappings, a bounded memory/pid cgroup,
 * and only SYS_PTRACE/SETUID/SETGID/KILL capabilities on this supervisor. The traced
 * child drops to uid/gid 1000 with no capabilities and no_new_privs. All runtime
 * descendants, including the synthetic PostgreSQL server, must be traced.
 */
export const NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1 = String.raw`
#define _GNU_SOURCE
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <elf.h>
#if defined(__aarch64__)
#include <asm/ptrace.h>
#endif
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <sys/ioctl.h>
#include <sys/time.h>
#include <sys/fsuid.h>
#include <sys/inotify.h>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <poll.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/sched.h>
#include <linux/io_uring.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <grp.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <errno.h>
#include <dirent.h>
#include <limits.h>
#include <time.h>
#include <unistd.h>

#ifndef PTRACE_GET_SYSCALL_INFO
#define PTRACE_GET_SYSCALL_INFO 0x420e
#endif
#ifndef PTRACE_SYSCALL_INFO_ENTRY
#define PTRACE_SYSCALL_INFO_ENTRY 1
#define PTRACE_SYSCALL_INFO_EXIT 2
#endif
#ifndef __WALL
#define __WALL 0x40000000
#endif
#ifndef MAP_SHARED_VALIDATE
#define MAP_SHARED_VALIDATE 0x03
#endif

#if defined(__aarch64__)
#define NP_AUDIT_ARCH AUDIT_ARCH_AARCH64
#define NP_PLATFORM "linux-aarch64"
#elif defined(__x86_64__)
#define NP_AUDIT_ARCH AUDIT_ARCH_X86_64
#define NP_PLATFORM "linux-x86_64"
#else
#error Unsupported renderer architecture
#endif

#define NP_MAX_TRACEES 1024
#define NP_MAX_PATH 4096
/* Fixed image-bound operational budget; never supplied by project or caller. */
#define NP_DEADLINE_MS 300000
#define NP_MAX_SYSCALLS 20000000ULL
#define NP_MAX_EXEC_ARGS 256
#define NP_MAX_CREATIONS 16384ULL
#define NP_MAX_OUTPUT_BYTES 1073741824ULL
#define NP_CHILD_UID 1000
#define NP_CHILD_GID 1000
#define NP_OPTIONS (PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACEVFORKDONE | PTRACE_O_TRACECLONE | PTRACE_O_TRACEEXEC | PTRACE_O_TRACEEXIT | PTRACE_O_EXITKILL)

struct np_syscall_info {
  uint8_t op;
  uint8_t pad[3];
  uint32_t arch;
  uint64_t instruction_pointer;
  uint64_t stack_pointer;
  union {
    struct { uint64_t nr; uint64_t args[6]; } entry;
    struct { int64_t rval; uint8_t is_error; } exit;
  } data;
};

struct np_task {
  pid_t pid;
  int alive;
  int stopped;
  int interrupt_sent;
  int signal;
  int inspect;
  int exiting;
  int exit_started;
  int signal_in_flight;
  int kernel_quiescent;
  int control_checked;
  uint64_t quiescence_checked_ms;
  uint64_t write_resumed_ms;
  int write_interrupt_requested;
  uint64_t write_yield_until_ms;
  int creation_seen;
  int failure_only_probe;
  int pending_next_exec;
  pid_t next_tgid;
  int synthetic_next_env;
  int pending_sysv_create;
  key_t pending_sysv_key;
  unsigned pending_sysv_attach;
  unsigned pending_sysv_rmid;
  unsigned pending_netlink;
  unsigned pending_socket;
  unsigned pending_bind;
  uint64_t pending_socketpair;
  pid_t vfork_child;
  unsigned bookkeeping_write_length;
  pid_t bookkeeping_open_target;
  int bookkeeping_open_value;
  int clear_refs_write;
  int terminal_status;
  unsigned terminal_waits;
  struct np_syscall_info call;
};

struct np_netlink_socket { unsigned long long inode; unsigned protocol; int bound; };
static struct np_netlink_socket netlink_sockets[16384];
static size_t used_netlink_sockets;
struct np_sysv_segment { int id; key_t key; long creator; int removed; };
struct np_sysv_row { long long key; int id; unsigned mode; unsigned long long size; long creator; unsigned uid; unsigned cuid; };
struct np_sysv_address { uint64_t address; unsigned segment; };
static struct np_sysv_segment sysv_segments[4];
static struct np_sysv_address sysv_addresses[128];
static size_t sysv_create_attempts, sysv_created, sysv_attach_attempts, sysv_address_count, sysv_rmid_calls;
static int sysv_reclaimed;
static struct np_task tasks[NP_MAX_TRACEES];
static size_t used_tasks;
static size_t live_tasks;
static size_t peak_tasks;
static size_t reaped_tasks;
static size_t terminal_waits;
static int kernel_children_empty;
static uint64_t syscall_count;
static uint64_t blocking_write_interrupts;
static uint64_t blocking_write_yields;
static uint64_t creation_operations;
static uint64_t charged_output_bytes;
static uint64_t blocked_runtime_probes;
static uint64_t blocked_ipv6_datagrams;
static uint64_t blocked_ipv4_datagrams;
static uint64_t blocked_nscd_probes;
static uint64_t blocked_empty_metadata;
static uint64_t blocked_next_env_metadata;
static struct stat next_directories[3], next_server;
static int next_environment_ready;
static uint64_t bookkeeping_opens;
static uint64_t bookkeeping_attempts;
static uint64_t bookkeeping_writes;
static uint64_t clear_refs_opens;
static uint64_t clear_refs_attempts;
static uint64_t clear_refs_writes;
static pid_t root_pid;
static pid_t supervisor_pid;
static pid_t exclusive_pid;
static int root_exit = -1;
static int root_signal;
static int root_reaped;
static int failed;
static int violation;
static int blocked_syscall = -1;
static const char *reason = "none";
/* Observational enums only: they never authorize a path or replace a deny. */
static const char *blocked_write_actor = "other";
static const char *blocked_write_target = "unresolved";
static const char *blocked_write_target_state = "unverifiable";
static char project_root[NP_MAX_PATH];
static char output_root[NP_MAX_PATH];
static char node_executable[NP_MAX_PATH];
static char driver_file[NP_MAX_PATH];
static char audit_file[NP_MAX_PATH];
static unsigned http_port;
static unsigned postgres_port;
static uint64_t started_ms;
static uint64_t root_finished_ms;

static void tick(int signal) { (void) signal; }

static uint64_t now_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return UINT64_MAX;
  return (uint64_t) ts.tv_sec * 1000ULL + (uint64_t) ts.tv_nsec / 1000000ULL;
}

static void fail(const char *code) {
  if (!failed) { failed = 1; reason = code; }
}

static int deny(const char *code, uint64_t nr) {
  if (!failed) {
    failed = 1;
    violation = 1;
    reason = code;
    blocked_syscall = nr <= INT_MAX ? (int) nr : -1;
  }
  return 0;
}

static struct np_task *find_task(pid_t pid) {
  size_t i;
  for (i = 0; i < used_tasks; i++)
    if (tasks[i].alive && tasks[i].pid == pid) return &tasks[i];
  return NULL;
}

static struct np_task *add_task(pid_t pid) {
  struct np_task *task = find_task(pid);
  if (task) return task;
  if (pid <= 0 || used_tasks >= NP_MAX_TRACEES) { fail("tracee-limit"); return NULL; }
  task = &tasks[used_tasks++];
  memset(task, 0, sizeof(*task));
  task->pid = pid;
  task->alive = 1;
  live_tasks++;
  if (live_tasks > peak_tasks) peak_tasks = live_tasks;
  return task;
}

/* A stopped tracee cannot race these bounded reads with a userspace writer.
 * Before inspection, every tracee is in a ptrace stop (not merely signalled).
 * io_uring, legacy AIO, userfaultfd and external writable mappings are forbidden.
 */
static int memory(pid_t pid, uint64_t address, void *target, size_t length) {
  size_t offset = 0;
  unsigned char *out = target;
  if (!address || address > UINTPTR_MAX || length > NP_MAX_PATH * 4U) return 0;
  while (offset < length) {
    long word;
    uintptr_t current;
    size_t in_word, take;
    if (address + offset < address) return 0;
    current = (uintptr_t) (address + offset);
    in_word = current % sizeof(word);
    take = sizeof(word) - in_word;
    errno = 0;
    word = ptrace(PTRACE_PEEKDATA, pid, (void *) (current - in_word), NULL);
    if (word == -1 && errno) return 0;
    if (take > length - offset) take = length - offset;
    memcpy(out + offset, (unsigned char *) &word + in_word, take);
    offset += take;
  }
  return 1;
}

static int string_at(pid_t pid, uint64_t address, char value[NP_MAX_PATH]) {
  size_t offset = 0;
  if (!address) return 0;
  while (offset < NP_MAX_PATH - 1) {
    size_t take = sizeof(long) - (size_t) ((address + offset) % sizeof(long));
    if (take > NP_MAX_PATH - 1 - offset) take = NP_MAX_PATH - 1 - offset;
    if (!memory(pid, address + offset, value + offset, take)) return 0;
    if (memchr(value + offset, 0, take)) return 1;
    offset += take;
  }
  return 0;
}

static int beneath(const char *path, const char *root) {
  size_t length = strlen(root);
  return strncmp(path, root, length) == 0 && (path[length] == 0 || path[length] == '/');
}

static const char *write_target_profile(const char *path) {
  if (beneath(path, output_root)) return "output";
  if (!strcmp(path, project_root)) return "project-root";
  if (beneath(path, project_root)) {
    const char *relative = path + strlen(project_root);
    if (beneath(relative, "/node_modules")) return "project-dependencies";
    if (beneath(relative, "/.next/standalone/.next/cache")) return "standalone-next-cache";
    if (beneath(relative, "/.next/standalone/.next/server")) return "standalone-next-server";
    if (beneath(relative, "/.next/standalone/.next")) return "standalone-next-root";
    if (beneath(relative, "/.next/standalone")) return "standalone-root";
    if (beneath(relative, "/.next/cache")) return "next-cache";
    if (beneath(relative, "/.next/server")) return "next-server";
    if (beneath(relative, "/.next")) return "next-root";
    return "project-source";
  }
  if (beneath(path, "/proc")) return "proc";
  if (beneath(path, "/sys")) return "sys";
  if (beneath(path, "/dev")) return "dev";
  if (beneath(path, "/tmp")) return "tmp";
  if (beneath(path, "/run")) return "run";
  if (beneath(path, "/usr") || beneath(path, "/opt") || beneath(path, "/bin") ||
      beneath(path, "/sbin") || beneath(path, "/lib") || beneath(path, "/lib64") ||
      beneath(path, "/etc") || beneath(path, "/var")) return "image";
  return "other";
}

/* Called only at the existing resolved write denial. Diagnostic lookup failures
 * retain bounded defaults and the original sticky denial and errno unchanged.
 * State is a best-effort observation, not an inode lease or policy decision. */
static void observe_blocked_write(pid_t pid, const char *path) {
  char proc[80], executable[NP_MAX_PATH];
  struct stat st;
  ssize_t length;
  int saved_errno = errno;
  if (failed) return;
  blocked_write_target = write_target_profile(path);
  if (snprintf(proc, sizeof(proc), "/proc/%ld/exe", (long) pid) < (int) sizeof(proc)) {
    length = readlink(proc, executable, sizeof(executable) - 1);
    if (length > 0 && length < (ssize_t) sizeof(executable) - 1) {
      executable[length] = 0;
      if (!strcmp(executable, "/usr/local/bin/node")) blocked_write_actor = "node";
      else if (!strcmp(executable, "/opt/np/chromium/chrome") ||
               !strcmp(executable, "/opt/np/chromium/chrome-headless-shell") ||
               !strcmp(executable, "/opt/np/chromium/chrome_crashpad_handler") ||
               !strcmp(executable, "/opt/np/chromium/chrome_sandbox")) blocked_write_actor = "chromium";
      else if (!strcmp(executable, "/usr/lib/postgresql/16/bin/postgres")) blocked_write_actor = "postgres";
    }
  }
  if (!lstat(path, &st)) {
    blocked_write_target_state = S_ISDIR(st.st_mode) ? "directory" :
      S_ISREG(st.st_mode) ? "file" : S_ISLNK(st.st_mode) ? "symlink" : "other";
  } else if (errno == ENOENT || errno == ENOTDIR) blocked_write_target_state = "absent";
  errno = saved_errno;
}

static int credential_path(const char *path) {
  char copy[NP_MAX_PATH];
  char *part, *save;
  size_t i, length = strlen(path);
  if (length >= sizeof(copy)) return 1;
  for (i = 0; i <= length; i++) {
    unsigned char c = (unsigned char) path[i];
    copy[i] = c >= 'A' && c <= 'Z' ? (char) (c + 'a' - 'A') : (char) c;
  }
  for (part = strtok_r(copy, "/", &save); part; part = strtok_r(NULL, "/", &save)) {
    size_t n = strlen(part);
    if (!strcmp(part, ".env") || !strncmp(part, ".env.", 5) ||
        !strcmp(part, ".git") || !strcmp(part, ".ssh") || !strcmp(part, ".aws") ||
        !strcmp(part, ".codex") || !strcmp(part, ".claude") ||
        !strcmp(part, ".npmrc") || !strcmp(part, ".netrc") || !strcmp(part, ".pgpass") ||
        !strcmp(part, "id_rsa") || !strcmp(part, "id_ed25519") ||
        !strncmp(part, ".pnpmfile.", 10)) return 1;
    if ((n > 4 && (!strcmp(part + n - 4, ".pem") || !strcmp(part + n - 4, ".key") ||
                   !strcmp(part + n - 4, ".p12") || !strcmp(part + n - 4, ".pfx")))) return 1;
  }
  return 0;
}

static int known_pid(pid_t pid);

static int proc_path_allowed(const char *path) {
  const char *part;
  char *end;
  long pid;
  if (!beneath(path, "/proc")) return 1;
  part = path + 5;
  while (*part == '/') part++;
  if (!*part) return 1;
  if (strstr(part, "/mem") || strstr(part, "/map_files") || strstr(part, "/root")) return 0;
  if (*part < '0' || *part > '9') return strcmp(part, "kcore") && strcmp(part, "keys");
  errno = 0;
  pid = strtol(part, &end, 10);
  if (errno || (*end != 0 && *end != '/') || pid <= 0 || pid > INT_MAX) return 0;
  /* Chrome checks a terminated, previously owned child's stat during shutdown.
   * Only this exact readonly record remains available after retirement. Every
   * other retired/foreign proc path stays closed, and writes are still subject
   * to the independent output-root check. Private PID ownership is mandatory. */
  return pid != supervisor_pid && (find_task((pid_t) pid) != NULL ||
    (!strcmp(end, "/stat") && known_pid((pid_t) pid)));
}

static int fd_target(pid_t pid, int fd, char target[NP_MAX_PATH]) {
  char proc[80];
  ssize_t length;
  if (fd < 0) return 0;
  if (snprintf(proc, sizeof(proc), "/proc/%ld/fd/%d", (long) pid, fd) >= (int) sizeof(proc)) return 0;
  length = readlink(proc, target, NP_MAX_PATH - 1);
  if (length <= 0 || length >= NP_MAX_PATH - 1) return 0;
  target[length] = 0;
  if (strstr(target, " (deleted)") && strncmp(target, "/memfd:", 7) && strncmp(target, "memfd:", 6)) {
    char *deleted = strstr(target, " (deleted)");
    *deleted = 0;
    if (!beneath(target, output_root)) return 0;
  }
  return 1;
}

/* Resolve every existing prefix, including symlinks, before accepting a missing
 * leaf. Checking only a lexical normalized path would miss symlink/.. escapes.
 */
static struct np_netlink_socket *socket_record(pid_t pid, uint64_t fd, int create) {
  char target[NP_MAX_PATH], *end;
  unsigned long long inode;
  size_t i;
  if (fd > INT_MAX || !fd_target(pid, (int) fd, target) || strncmp(target, "socket:[", 8)) {
    fail("socket-identity-unverifiable"); return NULL;
  }
  errno = 0;
  inode = strtoull(target + 8, &end, 10);
  if (errno || !inode || strcmp(end, "]")) { fail("socket-identity-unverifiable"); return NULL; }
  for (i = 0; i < used_netlink_sockets; i++) if (netlink_sockets[i].inode == inode) return &netlink_sockets[i];
  if (!create) return NULL;
  if (i == sizeof(netlink_sockets) / sizeof(netlink_sockets[0])) { fail("socket-limit"); return NULL; }
  used_netlink_sockets++;
  netlink_sockets[i].inode = inode;
  netlink_sockets[i].protocol = UINT_MAX;
  return &netlink_sockets[i];
}

static int resolve_path_depth(pid_t pid, int dirfd, const char *raw, char result[NP_MAX_PATH], unsigned depth) {
  char work[NP_MAX_PATH], base[NP_MAX_PATH], candidate[NP_MAX_PATH], resolved[NP_MAX_PATH];
  char *part, *save;
  size_t length;
  ssize_t count;
  struct stat st;
  if (depth > 40 || !raw[0] || strlen(raw) >= sizeof(work)) return 0;
  if (raw[0] == '/') strcpy(base, "/");
  else if (dirfd == AT_FDCWD) {
    char proc[80];
    snprintf(proc, sizeof(proc), "/proc/%ld/cwd", (long) pid);
    count = readlink(proc, base, sizeof(base) - 1);
    if (count <= 0 || count >= (ssize_t) sizeof(base) - 1) return 0;
    base[count] = 0;
  } else if (!fd_target(pid, dirfd, base) || base[0] != '/') return 0;
  strcpy(result, base);
  strcpy(work, raw);
  for (part = strtok_r(work, "/", &save); part; part = strtok_r(NULL, "/", &save)) {
    if (!strcmp(part, ".")) continue;
    if (!strcmp(part, "..")) {
      char *slash = strrchr(result, '/');
      if (slash && slash != result) *slash = 0; else strcpy(result, "/");
      continue;
    }
    /* proc/self is relative to the tracee, never to this supervisor. */
    if (!strcmp(result, "/proc") && (!strcmp(part, "self") || !strcmp(part, "thread-self"))) {
      snprintf(candidate, sizeof(candidate), "/proc/%ld", (long) pid);
    } else {
      length = strlen(result);
      if (length + strlen(part) + 2 > sizeof(candidate)) return 0;
      strcpy(candidate, result);
      if (length > 1) strcat(candidate, "/");
      strcat(candidate, part);
    }
    if (lstat(candidate, &st) == 0) {
      if (S_ISLNK(st.st_mode)) {
        char target[NP_MAX_PATH];
        count = readlink(candidate, target, sizeof(target) - 1);
        if (count <= 0 || count >= (ssize_t) sizeof(target) - 1) return 0;
        target[count] = 0;
        if (target[0] == '/') strcpy(base, target);
        else {
          if (strlen(result) + strlen(target) + 2 > sizeof(base)) return 0;
          strcpy(base, result);
          if (strcmp(base, "/")) strcat(base, "/");
          strcat(base, target);
        }
        if (save && *save) {
          if (strlen(base) + strlen(save) + 2 > sizeof(base)) return 0;
          strcat(base, "/"); strcat(base, save);
        }
        /* Resolve dangling links too: metadata probes of Chromium's random
         * SingletonCookie target must fail normally, while a dangling link to
         * an absent credential still records the forbidden attempted target. */
        return resolve_path_depth(pid, AT_FDCWD, base, result, depth + 1);
      }
      if (!realpath(candidate, resolved)) return 0;
      if (strlen(resolved) >= NP_MAX_PATH) return 0;
      strcpy(result, resolved);
    } else {
      /* Chromium also probes a full command-line string as a possible file.
       * An overlong component cannot resolve on this fixed Linux filesystem;
       * let its readonly metadata call receive ENAMETOOLONG normally. */
      if (errno != ENOENT && errno != ENOTDIR && errno != ENAMETOOLONG) return 0;
      strcpy(result, candidate);
    }
  }
  return 1;
}

static int resolve_path(pid_t pid, int dirfd, const char *raw, char result[NP_MAX_PATH]) {
  return resolve_path_depth(pid, dirfd, raw, result, 0);
}

/* A compatibility answer, never a credential read: this exact production Next
 * startup role can learn only ENOENT for four already absent immutable entries.
 * The supervisor binds all directory/server inodes before running project code,
 * reopens every parent without following symlinks, and requires a readonly mount
 * both initially and at each frozen attempt. A substituted parent or any final
 * entry (including dangling links/hardlinks) keeps the normal credential denial.
 */
static const char *next_env_names[] = { ".env.production.local", ".env.local", ".env.production", ".env" };

static int same_inode(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
    a->st_mode == b->st_mode && a->st_uid == b->st_uid && a->st_gid == b->st_gid &&
    a->st_nlink == b->st_nlink && a->st_size == b->st_size &&
    a->st_mtim.tv_sec == b->st_mtim.tv_sec && a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
    a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}

static int next_environment_snapshot(int initial) {
  const char *names[] = { "/np/project", ".next", "standalone" };
  const char *paths[] = { "/np/project", "/np/project/.next", "/np/project/.next/standalone" };
  int parent = -1, current = -1, result = 0;
  struct stat st; struct statvfs filesystem; char resolved[NP_MAX_PATH]; size_t i;
  if (strcmp(project_root, "/np/project")) return 0;
  for (i = 0; i < 3; i++) {
    current = i ? openat(parent, names[i], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
      : open(names[i], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (current < 0 || fstat(current, &st) || !S_ISDIR(st.st_mode) ||
        fstatvfs(current, &filesystem) || !(filesystem.f_flag & ST_RDONLY) ||
        !realpath(paths[i], resolved) || strcmp(resolved, paths[i])) goto done;
    if (initial) next_directories[i] = st;
    else if (!same_inode(&st, &next_directories[i])) goto done;
    if (parent >= 0) close(parent);
    parent = current; current = -1;
  }
  current = openat(parent, "server.js", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (current < 0 || fstat(current, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 ||
      fstatvfs(current, &filesystem) || !(filesystem.f_flag & ST_RDONLY) ||
      !realpath("/np/project/.next/standalone/server.js", resolved) ||
      strcmp(resolved, "/np/project/.next/standalone/server.js")) goto done;
  if (initial) next_server = st;
  else if (!same_inode(&st, &next_server)) goto done;
  for (i = 0; i < 4; i++) {
    errno = 0;
    if (fstatat(parent, next_env_names[i], &st, AT_SYMLINK_NOFOLLOW) != -1 || errno != ENOENT) goto done;
  }
  result = 1;
done:
  if (current >= 0) close(current);
  if (parent >= 0) close(parent);
  return result;
}

static pid_t task_tgid(pid_t pid) {
  char proc[80], line[256]; FILE *file; long value = 0;
  snprintf(proc, sizeof(proc), "/proc/%ld/status", (long) pid);
  file = fopen(proc, "r");
  if (!file) return 0;
  while (fgets(line, sizeof(line), file)) if (sscanf(line, "Tgid: %ld", &value) == 1) break;
  fclose(file);
  return value > 0 && value <= INT_MAX ? (pid_t) value : 0;
}

static int next_env_metadata(struct np_task *task, const char *raw, uint64_t nr) {
#if defined(__aarch64__) && defined(NT_ARM_SYSTEM_CALL)
  char expected[NP_MAX_PATH], proc[80], executable[NP_MAX_PATH];
  const uint64_t *a = task->call.data.entry.args;
  size_t i; ssize_t count; int skipped = -1; struct iovec registers = { &skipped, sizeof(skipped) };
  if (!next_environment_ready || !task->next_tgid || task_tgid(task->pid) != task->next_tgid ||
      a[0] != (uint64_t) (uint32_t) AT_FDCWD ||
      a[2] != 0 || a[3] != 4095 || !a[4] || a[5] != 4095 || blocked_next_env_metadata >= 16)
    return deny("credential-access", nr);
  for (i = 0; i < 4; i++) {
    snprintf(expected, sizeof(expected), "/np/project/.next/standalone/%s", next_env_names[i]);
    if (!strcmp(raw, expected)) break;
  }
  if (i == 4 || !next_environment_snapshot(0)) return deny("credential-access", nr);
  snprintf(proc, sizeof(proc), "/proc/%ld/exe", (long) task->pid);
  count = readlink(proc, executable, sizeof(executable) - 1);
  if (count <= 0 || count >= (ssize_t) sizeof(executable) - 1) return deny("credential-access", nr);
  executable[count] = 0;
  if (strcmp(executable, "/usr/local/bin/node") || strcmp(node_executable, executable)) return deny("credential-access", nr);
  /* Setting only the architecture's syscall number to -1 skips kernel statx.
   * Keep every sibling stopped through the matching -ENOSYS exit, then replace
   * only its return register with -ENOENT. No stat buffer is read or written. */
  if (ptrace(PTRACE_SETREGSET, task->pid, (void *) (uintptr_t) NT_ARM_SYSTEM_CALL, &registers) == -1 || registers.iov_len != sizeof(skipped)) {
    fail("metadata-probe-unavailable"); return 0;
  }
  task->synthetic_next_env = 1;
  return 1;
#else
  (void) task; (void) raw;
  return deny("credential-access", nr);
#endif
}

static int finish_next_env_metadata(struct np_task *task) {
#if defined(__aarch64__) && defined(NT_ARM_SYSTEM_CALL)
  struct user_pt_regs state; struct iovec registers = { &state, sizeof(state) };
  if (!next_environment_snapshot(0)) return deny("credential-access", SYS_statx);
  if (task->call.data.exit.rval != -ENOSYS ||
      ptrace(PTRACE_GETREGSET, task->pid, (void *) (uintptr_t) NT_PRSTATUS, &registers) == -1 || registers.iov_len != sizeof(state)) {
    fail("metadata-probe-unavailable"); return 0;
  }
  state.regs[0] = (uint64_t) (int64_t) -ENOENT;
  if (ptrace(PTRACE_SETREGSET, task->pid, (void *) (uintptr_t) NT_PRSTATUS, &registers) == -1) {
    fail("metadata-probe-unavailable"); return 0;
  }
  blocked_next_env_metadata++;
  blocked_runtime_probes++;
  task->synthetic_next_env = 0;
  return 1;
#else
  (void) task;
  fail("metadata-probe-unavailable"); return 0;
#endif
}

static int check_fd_alias(pid_t pid, const char *raw, int writing, uint64_t nr);

static int check_path_text(pid_t pid, int dirfd, const char *raw, int writing, uint64_t nr) {
  char path[NP_MAX_PATH];
  int alias;
  if (credential_path(raw)) return deny("credential-access", nr);
  if (raw[0] == '/' && !proc_path_allowed(raw)) return deny("supervisor-access", nr);
  alias = check_fd_alias(pid, raw, writing, nr);
  if (alias >= 0) return alias;
  if (!resolve_path(pid, dirfd, raw, path)) return deny("path-unverifiable", nr);
  if (credential_path(path)) return deny("credential-access", nr);
  if (!strcmp(path, audit_file) || !proc_path_allowed(path)) return deny("supervisor-access", nr);
  if (writing && !beneath(path, output_root) && strcmp(path, "/dev/null")) {
    observe_blocked_write(pid, path);
    return deny("write-outside-output", nr);
  }
  return 1;
}

static int check_fd(pid_t pid, uint64_t value, int writing, uint64_t nr);

static int check_path(pid_t pid, int dirfd, uint64_t pointer, int writing, uint64_t nr) {
  char raw[NP_MAX_PATH];
  if (!string_at(pid, pointer, raw)) return deny("argument-unverifiable", nr);
  if (!raw[0] && dirfd >= 0) return check_fd(pid, (uint64_t) dirfd, writing, nr);
  return check_path_text(pid, dirfd, raw, writing, nr);
}

static int check_fd(pid_t pid, uint64_t value, int writing, uint64_t nr) {
  char target[NP_MAX_PATH];
  if (value > INT_MAX || !fd_target(pid, (int) value, target)) return deny("descriptor-unverifiable", nr);
  if (!strncmp(target, "pipe:[", 6) || !strncmp(target, "socket:[", 8) ||
      !strncmp(target, "anon_inode:", 11) || !strncmp(target, "memfd:", 6) ||
      !strncmp(target, "/memfd:", 7)) return 1;
  return check_path_text(pid, AT_FDCWD, target, writing, nr);
}

static int check_fd_alias(pid_t pid, const char *raw, int writing, uint64_t nr) {
  char canonical[100], target[NP_MAX_PATH], *end;
  const char *number = NULL;
  long owner = pid, fd;
  if (!strncmp(raw, "/proc/self/fd/", 14)) number = raw + 14;
  else if (!strncmp(raw, "/proc/thread-self/fd/", 21)) number = raw + 21;
  else if (!strncmp(raw, "/proc/", 6)) {
    errno = 0;
    owner = strtol(raw + 6, &end, 10);
    if (!errno && owner > 0 && owner <= INT_MAX && !strncmp(end, "/fd/", 4)) number = end + 4;
  }
  if (!number) return -1;
  if (!find_task((pid_t) owner)) return deny("supervisor-access", nr);
  errno = 0;
  fd = strtol(number, &end, 10);
  if (errno || end == number || *end || fd < 0 || fd > 1023) return -1;
  snprintf(canonical, sizeof(canonical), "%ld", fd);
  if (strcmp(number, canonical) || !fd_target((pid_t) owner, (int) fd, target))
    return deny("descriptor-unverifiable", nr);
  /* Reopening a shared-memory/regular output fd is needed by Chromium. No
   * ambient pipe/socket or recursive proc-fd alias can become a new channel. */
  if (!strncmp(target, "pipe:[", 6) || !strncmp(target, "socket:[", 8) ||
      !strncmp(target, "anon_inode:", 11) || (beneath(target, "/proc") && strstr(target, "/fd/")))
    return deny("descriptor-alias-unavailable", nr);
  return check_fd((pid_t) owner, (uint64_t) fd, writing, nr);
}

/* Conservative, non-refundable budgets. A failed/overwriting write is charged
 * too, so kernel partial writes, retries and sparse-file offsets cannot refund
 * authority. The extra page covers unaligned extents; outer tmpfs/inode/cgroup
 * quotas remain mandatory and also bound anonymous/memfd-backed memory. */
static int charge_bytes(uint64_t bytes) {
  uint64_t charged;
  if (!bytes) return 1;
  if (bytes > NP_MAX_OUTPUT_BYTES) { fail("output-byte-limit"); return 0; }
  charged = ((bytes + 8191ULL) / 4096ULL) * 4096ULL;
  if (charged > NP_MAX_OUTPUT_BYTES - charged_output_bytes) { fail("output-byte-limit"); return 0; }
  charged_output_bytes += charged;
  return 1;
}

static int charge_creation(void) {
  if (++creation_operations > NP_MAX_CREATIONS) { fail("output-entry-limit"); return 0; }
  return 1;
}

static int charge_fd(pid_t pid, uint64_t value, uint64_t bytes, uint64_t nr) {
  char target[NP_MAX_PATH];
  if (value > INT_MAX || !fd_target(pid, (int) value, target)) return deny("descriptor-unverifiable", nr);
  return !beneath(target, output_root) || charge_bytes(bytes);
}

static int charge_iov(pid_t pid, uint64_t fd, uint64_t pointer, uint64_t count, uint64_t nr) {
  struct iovec vectors[1024];
  uint64_t total = 0;
  size_t i;
  if (!count) return 1;
  if (count > 1024 || !memory(pid, pointer, vectors, (size_t) count * sizeof(struct iovec)))
    return deny("argument-unverifiable", nr);
  for (i = 0; i < count; i++) {
    uint64_t size = vectors[i].iov_len;
    if (size > NP_MAX_OUTPUT_BYTES || total > NP_MAX_OUTPUT_BYTES - size) {
      fail("output-byte-limit"); return 0;
    }
    total += size;
  }
  return charge_fd(pid, fd, total, nr);
}

static int protect_mapping(pid_t pid, uint64_t address, uint64_t length, uint64_t protection, uint64_t nr) {
  char proc[80], line[NP_MAX_PATH + 256];
  FILE *maps;
  size_t lines = 0;
  if (!(protection & PROT_WRITE) || !length) return 1;
  if (address + length < address) return deny("argument-unverifiable", nr);
  snprintf(proc, sizeof(proc), "/proc/%ld/maps", (long) pid);
  maps = fopen(proc, "r");
  if (!maps) return deny("mapping-unverifiable", nr);
  while (fgets(line, sizeof(line), maps)) {
    unsigned long long start, end, offset, inode;
    unsigned major, minor;
    char permissions[5], *path;
    int consumed = 0;
    if (++lines > 65536 || !strchr(line, '\n') ||
        sscanf(line, "%llx-%llx %4s %llx %x:%x %llu %n", &start, &end, permissions,
          &offset, &major, &minor, &inode, &consumed) != 7 || !consumed) {
      fclose(maps); return deny("mapping-unverifiable", nr);
    }
    if (end <= address || start >= address + length || permissions[3] != 's') continue;
    path = line + consumed;
    while (*path == ' ' || *path == '\t') path++;
    path[strcspn(path, "\n")] = 0;
    /* Kernel-labelled anonymous shared memory has no external file writer. */
    if (!*path || *path == '[' || !strncmp(path, "/memfd:", 7) ||
        !strcmp(path, "/dev/zero (deleted)")) continue;
    if (*path != '/' || strchr(path, '\\') || !beneath(path, output_root)) {
      fclose(maps); return deny("write-outside-output", nr);
    }
  }
  if (ferror(maps)) { fclose(maps); return deny("mapping-unverifiable", nr); }
  fclose(maps);
  return 1;
}

static int registered_chromium(pid_t pid) {
  char proc[80], executable[NP_MAX_PATH];
  ssize_t length;
  snprintf(proc, sizeof(proc), "/proc/%ld/exe", (long) pid);
  length = readlink(proc, executable, sizeof(executable) - 1);
  if (length <= 0 || length >= (ssize_t) sizeof(executable) - 1) return 0;
  executable[length] = 0;
  return !strcmp(executable, "/opt/np/chromium/chrome") || !strcmp(executable, "/opt/np/chromium/chrome-headless-shell");
}

static int registered_postgres(pid_t pid) {
  char proc[80], executable[NP_MAX_PATH];
  ssize_t length;
  snprintf(proc, sizeof(proc), "/proc/%ld/exe", (long) pid);
  length = readlink(proc, executable, sizeof(executable) - 1);
  if (length <= 0 || length >= (ssize_t) sizeof(executable) - 1) return 0;
  executable[length] = 0;
  return !strcmp(executable, "/usr/lib/postgresql/16/bin/postgres");
}

/* Only the fixed PostgreSQL data-directory interlock is admitted. Its actual
 * shared buffers remain mmap-backed. The inspected private IPC namespace is a
 * mandatory outer boundary; no host IPC object may be visible to this runner. */
static int sysv_snapshot(int id, struct np_sysv_row *result) {
  FILE *table = fopen("/proc/sysvipc/shm", "r");
  char line[1024];
  size_t lines = 0;
  if (!table || !fgets(line, sizeof(line), table)) { if (table) fclose(table); return -1; }
  while (fgets(line, sizeof(line), table)) {
    struct np_sysv_row row;
    unsigned gid, cgid;
    long last;
    unsigned long long attached;
    if (++lines > 4096 || !strchr(line, '\n') ||
        sscanf(line, "%lld %d %o %llu %ld %ld %llu %u %u %u %u", &row.key, &row.id,
          &row.mode, &row.size, &row.creator, &last, &attached, &row.uid, &gid, &row.cuid, &cgid) != 11) {
      fclose(table); return -1;
    }
    if (row.id == id) { *result = row; fclose(table); return 1; }
  }
  if (ferror(table)) { fclose(table); return -1; }
  fclose(table);
  return 0;
}

static int sysv_index(uint64_t id) {
  size_t i;
  if (id > INT_MAX) return -1;
  for (i = 0; i < sysv_created; i++) if (sysv_segments[i].id == (int) id) return (int) i;
  return -1;
}

static int sysv_validate(size_t index) {
  struct np_sysv_segment *segment = &sysv_segments[index];
  struct np_sysv_row row;
  int state = sysv_snapshot(segment->id, &row);
  if (state == -1) { fail("sysv-ipc-unverifiable"); return 0; }
  if (!state && segment->removed) return 1;
  if (state != 1 || row.size != 56 || row.uid != NP_CHILD_UID || row.cuid != NP_CHILD_UID ||
      (row.mode & 0777) != 0600 || row.creator != segment->creator ||
      (row.key != segment->key && !(segment->removed && row.key == IPC_PRIVATE))) {
    fail("sysv-ipc-identity"); return 0;
  }
  return 1;
}

static int sysv_owned(pid_t pid, uint64_t id, uint64_t nr) {
  int index;
  if (!registered_postgres(pid)) { deny("sysv-ipc-role", nr); return -1; }
  index = sysv_index(id);
  if (index < 0) { deny("sysv-ipc-foreign-id", nr); return -1; }
  return sysv_validate((size_t) index) ? index : -1;
}

static int sysv_mapping(pid_t pid, uint64_t address, size_t index) {
  char proc[80], line[1024], expected[80];
  FILE *maps;
  size_t lines = 0;
  snprintf(proc, sizeof(proc), "/proc/%ld/maps", (long) pid);
  snprintf(expected, sizeof(expected), "/SYSV%08x (deleted)", (unsigned) sysv_segments[index].key);
  maps = fopen(proc, "r");
  if (!maps) return 0;
  while (fgets(line, sizeof(line), maps)) {
    unsigned long long start, end, offset, inode;
    char permissions[5], device[32], *name;
    int consumed = 0;
    if (++lines > 16384 || !strchr(line, '\n') ||
        sscanf(line, "%llx-%llx %4s %llx %31s %llu %n", &start, &end, permissions,
          &offset, device, &inode, &consumed) != 6) { fclose(maps); return 0; }
    if (start != address) continue;
    name = line + consumed;
    while (*name == ' ' || *name == '\t') name++;
    name[strcspn(name, "\n")] = 0;
    fclose(maps);
    return end > start && end - start == (unsigned long long) getpagesize() && !offset &&
      permissions[3] == 's' && inode == (unsigned) sysv_segments[index].id && !strcmp(name, expected);
  }
  fclose(maps);
  return 0;
}

static int sysv_cleanup_verified(void) {
  size_t i;
  for (i = 0; i < sysv_created; i++) {
    struct np_sysv_row row;
    int state = sysv_snapshot(sysv_segments[i].id, &row);
    if (state != 0) {
      fail(state < 0 ? "sysv-ipc-unverifiable" : "sysv-ipc-cleanup");
      return 0;
    }
  }
  sysv_reclaimed = 1;
  return 1;
}

static int bookkeeping_target(const char *path) {
  char canonical[100], *end;
  long target;
  if (strncmp(path, "/proc/", 6)) return 0;
  errno = 0;
  target = strtol(path + 6, &end, 10);
  if (errno || target <= 0 || target > INT_MAX || strcmp(end, "/oom_score_adj")) return 0;
  snprintf(canonical, sizeof(canonical), "/proc/%ld/oom_score_adj", target);
  return !strcmp(path, canonical) && find_task((pid_t) target) != NULL;
}

static int clear_refs_target(const char *path) {
  char canonical[100], *end;
  long target;
  if (strncmp(path, "/proc/", 6)) return 0;
  errno = 0;
  target = strtol(path + 6, &end, 10);
  if (errno || target <= 0 || target > INT_MAX || strcmp(end, "/clear_refs")) return 0;
  snprintf(canonical, sizeof(canonical), "/proc/%ld/clear_refs", target);
  return !strcmp(path, canonical) && find_task((pid_t) target) && registered_chromium((pid_t) target);
}

static int bookkeeping_value(pid_t pid, int *value) {
  char path[100], extra;
  FILE *field;
  int matched;
  snprintf(path, sizeof(path), "/proc/%ld/oom_score_adj", (long) pid);
  field = fopen(path, "r");
  if (!field) return 0;
  matched = fscanf(field, "%d %c", value, &extra);
  fclose(field);
  return matched == 1 && *value >= 0 && *value <= 1000;
}

/* The only writable proc field is non-decreasing OOM bookkeeping for one of
 * this run's frozen, live tracees. It cannot protect a process more strongly,
 * alter the supervisor/host, or expose source, credentials or other proc data. */
static int bookkeeping_write(struct np_task *task, uint64_t fd, uint64_t pointer, uint64_t length, uint64_t nr) {
  char target[NP_MAX_PATH], text[6];
  unsigned value = 0;
  int current;
  size_t i, digits;
  if (fd > INT_MAX || !fd_target(task->pid, (int) fd, target)) return -1;
  if (clear_refs_target(target)) {
    if (!registered_chromium(task->pid) || length != 1 || !memory(task->pid, pointer, text, 1) || text[0] != '5')
      return deny("process-bookkeeping-unavailable", nr);
    task->clear_refs_write = 1;
    clear_refs_attempts++;
    return 1;
  }
  if (!bookkeeping_target(target)) return -1;
  if (!length || length > 5 || !memory(task->pid, pointer, text, (size_t) length))
    return deny("process-bookkeeping-unavailable", nr);
  digits = (size_t) length;
  if (text[digits - 1] == '\n') digits--;
  if (!digits || (digits > 1 && text[0] == '0')) return deny("process-bookkeeping-unavailable", nr);
  for (i = 0; i < digits; i++) {
    if (text[i] < '0' || text[i] > '9') return deny("process-bookkeeping-unavailable", nr);
    value = value * 10 + (unsigned) (text[i] - '0');
  }
  if (value > 1000) return deny("process-bookkeeping-unavailable", nr);
  if (!bookkeeping_value((pid_t) strtol(target + 6, NULL, 10), &current))
    return deny("process-bookkeeping-unavailable", nr);
  if (value < (unsigned) current) return deny("process-priority-decrease", nr);
  task->bookkeeping_write_length = (unsigned) length;
  bookkeeping_attempts++;
  return 1;
}

/* Resolve socket identity from the kernel table while every possible fd-table
 * writer is stopped. No tracee-provided family label is trusted after dup/fork
 * or SCM_RIGHTS. Other protocols never acquire an uninspected write path. */
static int route_socket(pid_t pid, uint64_t fd, uint64_t nr) {
  char target[NP_MAX_PATH], proc[100], line[1024], *end;
  unsigned long long wanted;
  FILE *table;
  size_t lines = 0;
  if (fd > INT_MAX || !fd_target(pid, (int) fd, target)) { deny("descriptor-unverifiable", nr); return -1; }
  if (strncmp(target, "socket:[", 8)) return 0;
  errno = 0;
  wanted = strtoull(target + 8, &end, 10);
  if (errno || strcmp(end, "]")) { deny("descriptor-unverifiable", nr); return -1; }
  {
    size_t i;
    /* Unbound Netlink sockets do not appear in /proc/net/netlink. Capture the
     * kernel inode on successful creation before userspace can close/dup/send;
     * every inherited/transferred alias retains that same inode identity. */
    for (i = 0; i < used_netlink_sockets; i++) if (netlink_sockets[i].inode == wanted)
      return netlink_sockets[i].protocol == NETLINK_ROUTE ? 1 :
        netlink_sockets[i].protocol == NETLINK_KOBJECT_UEVENT ? 2 : 0;
  }
  snprintf(proc, sizeof(proc), "/proc/%ld/net/netlink", (long) pid);
  table = fopen(proc, "r");
  if (!table || !fgets(line, sizeof(line), table)) {
    if (table) fclose(table);
    deny("network-unverifiable", nr); return -1;
  }
  while (fgets(line, sizeof(line), table)) {
    char *token, *save;
    unsigned field = 0;
    unsigned long protocol = ULONG_MAX;
    unsigned long long inode = 0;
    if (++lines > 4096 || !strchr(line, '\n')) { fclose(table); deny("network-unverifiable", nr); return -1; }
    for (token = strtok_r(line, " \t\n", &save); token; token = strtok_r(NULL, " \t\n", &save), field++) {
      if (field == 1) {
        errno = 0; protocol = strtoul(token, &end, 10);
        if (errno || *end) { fclose(table); deny("network-unverifiable", nr); return -1; }
      }
      if (field == 9) {
        errno = 0; inode = strtoull(token, &end, 10);
        if (errno || *end) { fclose(table); deny("network-unverifiable", nr); return -1; }
      }
    }
    if (field != 10) { fclose(table); deny("network-unverifiable", nr); return -1; }
    if (inode == wanted) {
      fclose(table);
      if (protocol == NETLINK_ROUTE) return 1;
      if (protocol == NETLINK_KOBJECT_UEVENT) return 2;
      deny("socket-family-unavailable", nr); return -1;
    }
  }
  if (ferror(table)) { fclose(table); deny("network-unverifiable", nr); return -1; }
  fclose(table);
  return 0;
}

static int route_bytes(const unsigned char *bytes, size_t length, uint64_t nr) {
  size_t offset = 0, messages = 0;
  if (!length || length > 16384) return deny("netlink-write-unverifiable", nr);
  while (offset < length) {
    struct nlmsghdr header;
    size_t step;
    if (++messages > 64 || length - offset < sizeof(header)) return deny("netlink-write-unverifiable", nr);
    memcpy(&header, bytes + offset, sizeof(header));
    if (header.nlmsg_len <= sizeof(header) || header.nlmsg_len > length - offset ||
        !(header.nlmsg_flags & NLM_F_REQUEST) ||
        (header.nlmsg_flags & ~(NLM_F_REQUEST | NLM_F_DUMP | NLM_F_ACK)) ||
        (header.nlmsg_type != RTM_GETLINK && header.nlmsg_type != RTM_GETADDR && header.nlmsg_type != RTM_GETROUTE) ||
        (header.nlmsg_pid && !find_task((pid_t) header.nlmsg_pid))) return deny("netlink-mutation", nr);
    step = NLMSG_ALIGN(header.nlmsg_len);
    if (step > length - offset) {
      if (header.nlmsg_len != length - offset) return deny("netlink-write-unverifiable", nr);
      offset = length;
    } else offset += step;
  }
  return 1;
}

static int route_payload(pid_t pid, uint64_t pointer, uint64_t length, uint64_t nr) {
  unsigned char bytes[16384];
  if (!length || length > sizeof(bytes) || !memory(pid, pointer, bytes, (size_t) length))
    return deny("netlink-write-unverifiable", nr);
  return route_bytes(bytes, (size_t) length, nr);
}

static int route_vectors(pid_t pid, uint64_t pointer, uint64_t count, uint64_t nr) {
  struct iovec vectors[64];
  unsigned char bytes[16384];
  size_t i, length = 0;
  if (!count || count > 64 || !memory(pid, pointer, vectors, (size_t) count * sizeof(struct iovec)))
    return deny("netlink-write-unverifiable", nr);
  for (i = 0; i < count; i++) {
    if (vectors[i].iov_len > sizeof(bytes) - length ||
        !memory(pid, (uint64_t) (uintptr_t) vectors[i].iov_base, bytes + length, vectors[i].iov_len))
      return deny("netlink-write-unverifiable", nr);
    length += vectors[i].iov_len;
  }
  return route_bytes(bytes, length, nr);
}

static int endpoint(pid_t pid, uint64_t pointer, uint64_t length, uint64_t nr) {
  struct sockaddr_storage address;
  uint16_t family;
  if (length < sizeof(family) || length > sizeof(address) ||
      !memory(pid, pointer, &address, (size_t) length)) return deny("network-unverifiable", nr);
  family = address.ss_family;
  if (family == AF_UNSPEC && nr == SYS_connect) {
    size_t i;
    const unsigned char *bytes = (const unsigned char *) &address;
    for (i = sizeof(family); i < length; i++) if (bytes[i]) return deny("network-outside-loopback", nr);
    return 1;
  }
  if (family == AF_INET && length >= sizeof(struct sockaddr_in)) {
    struct sockaddr_in *in = (struct sockaddr_in *) &address;
    unsigned port = ntohs(in->sin_port);
    if (in->sin_addr.s_addr == htonl(INADDR_LOOPBACK) && (port == http_port || port == postgres_port)) return 1;
  } else if (family == AF_INET6 && length >= sizeof(struct sockaddr_in6)) {
    struct sockaddr_in6 *in6 = (struct sockaddr_in6 *) &address;
    unsigned port = ntohs(in6->sin6_port);
    if (IN6_IS_ADDR_LOOPBACK(&in6->sin6_addr) && !in6->sin6_scope_id &&
        (port == http_port || port == postgres_port)) return 1;
  } else if (family == AF_UNIX && length > offsetof(struct sockaddr_un, sun_path)) {
    struct sockaddr_un *un = (struct sockaddr_un *) &address;
    size_t n = (size_t) length - offsetof(struct sockaddr_un, sun_path);
    char unix_path[sizeof(un->sun_path) + 1];
    if (!un->sun_path[0] || n > sizeof(un->sun_path))
      return deny("unix-endpoint-unverifiable", nr);
    memcpy(unix_path, un->sun_path, n);
    unix_path[n] = 0;
    if (nr == SYS_connect && registered_chromium(pid)) {
      char resolved[NP_MAX_PATH];
      struct stat st;
      /* glibc queries NSCD even for local account/host lookups. The fixed image
       * has no service at this root-read-only path. Freeze every tracee, verify
       * absence, then require a negative result before any userspace resumes. */
      if (resolve_path(pid, AT_FDCWD, unix_path, resolved) && !strcmp(resolved, "/run/nscd/socket") &&
          lstat(resolved, &st) == -1 && errno == ENOENT && blocked_runtime_probes < 256) {
        find_task(pid)->failure_only_probe = 4;
        return 1;
      }
    }
    return check_path_text(pid, AT_FDCWD, unix_path, 1, nr);
  } else if (family == AF_NETLINK && length == sizeof(struct sockaddr_nl)) {
    struct sockaddr_nl *nl = (struct sockaddr_nl *) &address;
    unsigned groups = RTMGRP_LINK | RTMGRP_NOTIFY | RTMGRP_IPV4_IFADDR | RTMGRP_IPV4_ROUTE |
      RTMGRP_IPV6_IFADDR | RTMGRP_IPV6_ROUTE;
    if (nl->nl_pad) return deny("network-unverifiable", nr);
    if (nr == SYS_bind) {
      if ((!nl->nl_pid || (nl->nl_pid <= INT_MAX && find_task((pid_t) nl->nl_pid))) && !(nl->nl_groups & ~groups)) return 1;
    } else if (!nl->nl_pid && !nl->nl_groups) return 1;
    return deny("netlink-external-peer", nr);
  }
  return deny("network-outside-loopback", nr);
}

static int message_endpoint(pid_t pid, uint64_t fd, uint64_t pointer, uint64_t nr) {
  struct msghdr header;
  int route;
  if (!memory(pid, pointer, &header, sizeof(header))) return deny("network-unverifiable", nr);
  if ((header.msg_name || header.msg_namelen) &&
      !endpoint(pid, (uint64_t) (uintptr_t) header.msg_name, header.msg_namelen, nr)) return 0;
  route = route_socket(pid, fd, nr);
  if (route < 0) return 0;
  if (route == 2) return deny("read-only-channel-write", nr);
  return !route || route_vectors(pid, (uint64_t) (uintptr_t) header.msg_iov, header.msg_iovlen, nr);
}

static int inspect_write(struct np_task *task, uint64_t fd, uint64_t pointer, uint64_t length, uint64_t nr) {
  int bookkeeping = bookkeeping_write(task, fd, pointer, length, nr);
  int route;
  if (bookkeeping >= 0) return bookkeeping;
  if (!check_fd(task->pid, fd, 1, nr)) return 0;
  route = route_socket(task->pid, fd, nr);
  if (route == 2) return deny("read-only-channel-write", nr);
  if (route < 0 || (route && !route_payload(task->pid, pointer, length, nr))) return 0;
  return charge_fd(task->pid, fd, length, nr);
}

static int inspect_writev(pid_t pid, uint64_t fd, uint64_t pointer, uint64_t count, uint64_t nr) {
  int route;
  if (!check_fd(pid, fd, 1, nr)) return 0;
  route = route_socket(pid, fd, nr);
  if (route == 2) return deny("read-only-channel-write", nr);
  if (route < 0 || (route && !route_vectors(pid, pointer, count, nr))) return 0;
  return charge_iov(pid, fd, pointer, count, nr);
}

static int opaque_destination(pid_t pid, uint64_t fd, uint64_t nr) {
  int route = route_socket(pid, fd, nr);
  return route < 0 ? 0 : route ? deny("netlink-write-unverifiable", nr) : 1;
}

static int execution(pid_t pid, uint64_t path_pointer, uint64_t argv_pointer, uint64_t nr) {
  char raw[NP_MAX_PATH], path[NP_MAX_PATH];
  const char *name;
  size_t i;
  int allowed = 0, next_role = next_environment_ready;
  struct np_task *task = find_task(pid);
  const char *next_args[] = { "/usr/local/bin/node", "--import", "/opt/np/driver/clock.mjs", "/np/project/.next/standalone/server.js" };
  if (!task) return deny("executable-unverifiable", nr);
  task->pending_next_exec = 0;
  if (!string_at(pid, path_pointer, raw) || !resolve_path(pid, AT_FDCWD, raw, path))
    return deny("executable-unverifiable", nr);
  if (!strcmp(path, node_executable) || !strcmp(path, "/usr/lib/postgresql/16/bin/postgres")) allowed = 1;
  name = strrchr(path, '/');
  if (beneath(path, "/opt/np/chromium") && name &&
      (!strcmp(name + 1, "chrome") || !strcmp(name + 1, "chrome-headless-shell") ||
       !strcmp(name + 1, "chrome_crashpad_handler") || !strcmp(name + 1, "chrome_sandbox"))) allowed = 1;
  if (!allowed || credential_path(path)) return deny("unregistered-executable", nr);
  for (i = 0; i < NP_MAX_EXEC_ARGS; i++) {
    uint64_t argument;
    char text[NP_MAX_PATH];
    if (!memory(pid, argv_pointer + i * sizeof(uint64_t), &argument, sizeof(argument)))
      return deny("argument-unverifiable", nr);
    if (!argument) { task->pending_next_exec = next_role && i == 4 && !strcmp(path, "/usr/local/bin/node") && !strcmp(node_executable, path); return 1; }
    if (!string_at(pid, argument, text)) return deny("argument-unverifiable", nr);
    if (i >= 4 || strcmp(text, next_args[i])) next_role = 0;
  }
  return deny("argument-limit", nr);
}

static int clone_flags(uint64_t flags, uint64_t nr) {
  uint64_t forbidden = CLONE_UNTRACED | CLONE_PARENT | CLONE_NEWNS | CLONE_NEWCGROUP |
    CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWUSER | CLONE_NEWPID | CLONE_NEWNET;
  if (flags & forbidden) return deny("process-escape", nr);
  return 1;
}

static int known_pid(pid_t pid) {
  size_t i;
  for (i = 0; i < used_tasks; i++) if (tasks[i].pid == pid) return 1;
  return 0;
}

static int retired_zombie(pid_t pid) {
  char path[80], line[8192], *end;
  FILE *stat;
  if (!known_pid(pid) || find_task(pid)) return 0;
  snprintf(path, sizeof(path), "/proc/%ld/stat", (long) pid);
  stat = fopen(path, "r");
  if (!stat) return 0;
  if (!fgets(line, sizeof(line), stat)) { fclose(stat); return 0; }
  fclose(stat);
  end = strrchr(line, ')');
  return end && end[1] == ' ' && end[2] == 'Z' && end[3] == ' ';
}

static int process_signal(uint64_t target, uint64_t nr) {
  int64_t signed_target = (int32_t) target;
  pid_t group;
  DIR *proc;
  struct dirent *entry;
  if (signed_target > 0 && signed_target <= INT_MAX) {
    pid_t pid = (pid_t) signed_target;
    if (pid == supervisor_pid) return deny("external-process-signal", nr);
    if (find_task(pid)) return 1;
    errno = 0;
    if (known_pid(pid) && getpgid(pid) == -1 && errno == ESRCH) return 1;
    if (retired_zombie(pid)) return 1;
    return deny("external-process-signal", nr);
  }
  if (signed_target >= -1 || signed_target < -INT_MAX) return deny("external-process-signal", nr);
  group = (pid_t) -signed_target;
  if (!known_pid(group)) return deny("external-process-signal", nr);
  proc = opendir("/proc");
  if (!proc) return deny("process-group-unverifiable", nr);
  /* All tracees remain frozen while group membership is inspected. Private PID
   * namespaces and complete descendant tracing make this a closed group, never
   * an ambient host process-group permission. A fully reaped group may yield
   * ESRCH, as required by the browser's final absence check. */
  while ((entry = readdir(proc)) != NULL) {
    char *end;
    long value;
    pid_t member_group;
    if (entry->d_name[0] < '0' || entry->d_name[0] > '9') continue;
    errno = 0;
    value = strtol(entry->d_name, &end, 10);
    if (errno || *end || value <= 0 || value > INT_MAX) { closedir(proc); return deny("process-group-unverifiable", nr); }
    errno = 0;
    member_group = getpgid((pid_t) value);
    if (member_group == -1 && errno == ESRCH) continue;
    if (member_group == -1) { closedir(proc); return deny("process-group-unverifiable", nr); }
    if (member_group == group && !find_task((pid_t) value) && !retired_zombie((pid_t) value)) {
      closedir(proc); return deny("external-process-signal", nr);
    }
  }
  closedir(proc);
  return 1;
}

static int node_runtime_probe(struct np_task *task, uint64_t nr) {
  struct io_uring_params parameters, expected;
  char proc[80], executable[NP_MAX_PATH];
  uint64_t *a = task->call.data.entry.args;
  ssize_t count;
  if (a[0] != 256 || !memory(task->pid, a[1], &parameters, sizeof(parameters)))
    return deny("asynchronous-memory-operation", nr);
  memset(&expected, 0, sizeof(expected));
  expected.flags = parameters.flags;
  if ((parameters.flags != 0 && parameters.flags != 0x10000U) ||
      memcmp(&parameters, &expected, sizeof(parameters))) return deny("asynchronous-memory-operation", nr);
  snprintf(proc, sizeof(proc), "/proc/%ld/exe", (long) task->pid);
  count = readlink(proc, executable, sizeof(executable) - 1);
  if (count <= 0 || count >= (ssize_t) sizeof(executable) - 1) return deny("executable-unverifiable", nr);
  executable[count] = 0;
  if (strcmp(executable, node_executable) || blocked_runtime_probes >= 256)
    return deny("asynchronous-memory-operation", nr);
  /* libuv's fixed empty epoll-control probe is allowed to FAIL only. Docker's
   * default seccomp denies setup. Even on a host that creates this empty ring,
   * all tracees remain frozen and are killed at syscall exit before userspace
   * can receive/map its fd. No submitted work/SQPOLL flag is ever permitted. */
  task->failure_only_probe = 1;
  return 1;
}

/* The allowlist below deliberately fails closed on future/compat syscalls.
 * These calls have no pathname, destination address, external process target or
 * asynchronous foreign-memory operation. Pointer-bearing effect calls are
 * separately stopped and inspected before the kernel can consume arguments.
 */
static int harmless(uint64_t nr) {
  switch (nr) {
#ifdef SYS_memfd_create
    case SYS_memfd_create:
#endif
#ifdef SYS_getcwd
    case SYS_getcwd:
#endif
#ifdef SYS_read
    case SYS_read:
#endif
#ifdef SYS_readv
    case SYS_readv:
#endif
#ifdef SYS_pread64
    case SYS_pread64:
#endif
#ifdef SYS_preadv
    case SYS_preadv:
#endif
#ifdef SYS_preadv2
    case SYS_preadv2:
#endif
#ifdef SYS_close
    case SYS_close:
#endif
#ifdef SYS_close_range
    case SYS_close_range:
#endif
#ifdef SYS_fstat
    case SYS_fstat:
#endif
#ifdef SYS_fstatfs
    case SYS_fstatfs:
#endif
#ifdef SYS_lseek
    case SYS_lseek:
#endif
#ifdef SYS_brk
    case SYS_brk:
#endif
#ifdef SYS_munmap
    case SYS_munmap:
#endif
#ifdef SYS_mremap
    case SYS_mremap:
#endif
#ifdef SYS_pkey_alloc
    case SYS_pkey_alloc:
#endif
#ifdef SYS_pkey_free
    case SYS_pkey_free:
#endif
#ifdef SYS_madvise
    case SYS_madvise:
#endif
#ifdef SYS_mincore
    case SYS_mincore:
#endif
#ifdef SYS_msync
    case SYS_msync:
#endif
#ifdef SYS_membarrier
    case SYS_membarrier:
#endif
#ifdef SYS_sched_yield
    case SYS_sched_yield:
#endif
#ifdef SYS_sched_get_priority_max
    case SYS_sched_get_priority_max:
#endif
#ifdef SYS_sched_get_priority_min
    case SYS_sched_get_priority_min:
#endif
#ifdef SYS_getpid
    case SYS_getpid:
#endif
#ifdef SYS_getppid
    case SYS_getppid:
#endif
#ifdef SYS_gettid
    case SYS_gettid:
#endif
#ifdef SYS_getuid
    case SYS_getuid:
#endif
#ifdef SYS_geteuid
    case SYS_geteuid:
#endif
#ifdef SYS_getgid
    case SYS_getgid:
#endif
#ifdef SYS_getegid
    case SYS_getegid:
#endif
#ifdef SYS_getresuid
    case SYS_getresuid:
#endif
#ifdef SYS_getresgid
    case SYS_getresgid:
#endif
#ifdef SYS_getgroups
    case SYS_getgroups:
#endif
#ifdef SYS_getpgrp
    case SYS_getpgrp:
#endif
#ifdef SYS_uname
    case SYS_uname:
#endif
#ifdef SYS_sysinfo
    case SYS_sysinfo:
#endif
#ifdef SYS_getrandom
    case SYS_getrandom:
#endif
#ifdef SYS_rseq
    case SYS_rseq:
#endif
#ifdef SYS_arch_prctl
    case SYS_arch_prctl:
#endif
#ifdef SYS_set_tid_address
    case SYS_set_tid_address:
#endif
#ifdef SYS_set_robust_list
    case SYS_set_robust_list:
#endif
#ifdef SYS_futex
    case SYS_futex:
#endif
#ifdef SYS_futex_waitv
    case SYS_futex_waitv:
#endif
#ifdef SYS_rt_sigaction
    case SYS_rt_sigaction:
#endif
#ifdef SYS_rt_sigprocmask
    case SYS_rt_sigprocmask:
#endif
#ifdef SYS_rt_sigreturn
    case SYS_rt_sigreturn:
#endif
#ifdef SYS_rt_sigpending
    case SYS_rt_sigpending:
#endif
#ifdef SYS_rt_sigtimedwait
    case SYS_rt_sigtimedwait:
#endif
#ifdef SYS_rt_sigsuspend
    case SYS_rt_sigsuspend:
#endif
#ifdef SYS_sigaltstack
    case SYS_sigaltstack:
#endif
#ifdef SYS_restart_syscall
    case SYS_restart_syscall:
#endif
#ifdef SYS_clock_gettime
    case SYS_clock_gettime:
#endif
#ifdef SYS_clock_getres
    case SYS_clock_getres:
#endif
#ifdef SYS_clock_nanosleep
    case SYS_clock_nanosleep:
#endif
#ifdef SYS_gettimeofday
    case SYS_gettimeofday:
#endif
#ifdef SYS_time
    case SYS_time:
#endif
#ifdef SYS_nanosleep
    case SYS_nanosleep:
#endif
#ifdef SYS_times
    case SYS_times:
#endif
#ifdef SYS_getcpu
    case SYS_getcpu:
#endif
#ifdef SYS_poll
    case SYS_poll:
#endif
#ifdef SYS_ppoll
    case SYS_ppoll:
#endif
#ifdef SYS_select
    case SYS_select:
#endif
#ifdef SYS_pselect6
    case SYS_pselect6:
#endif
#ifdef SYS_epoll_create
    case SYS_epoll_create:
#endif
#ifdef SYS_epoll_create1
    case SYS_epoll_create1:
#endif
#ifdef SYS_epoll_ctl
    case SYS_epoll_ctl:
#endif
#ifdef SYS_epoll_wait
    case SYS_epoll_wait:
#endif
#ifdef SYS_epoll_pwait
    case SYS_epoll_pwait:
#endif
#ifdef SYS_epoll_pwait2
    case SYS_epoll_pwait2:
#endif
#ifdef SYS_pipe
    case SYS_pipe:
#endif
#ifdef SYS_pipe2
    case SYS_pipe2:
#endif
#ifdef SYS_dup
    case SYS_dup:
#endif
#ifdef SYS_dup2
    case SYS_dup2:
#endif
#ifdef SYS_dup3
    case SYS_dup3:
#endif
#ifdef SYS_eventfd
    case SYS_eventfd:
#endif
#ifdef SYS_eventfd2
    case SYS_eventfd2:
#endif
#ifdef SYS_timerfd_create
    case SYS_timerfd_create:
#endif
#ifdef SYS_timerfd_settime
    case SYS_timerfd_settime:
#endif
#ifdef SYS_timerfd_gettime
    case SYS_timerfd_gettime:
#endif
#ifdef SYS_timer_create
    case SYS_timer_create:
#endif
#ifdef SYS_timer_settime
    case SYS_timer_settime:
#endif
#ifdef SYS_timer_gettime
    case SYS_timer_gettime:
#endif
#ifdef SYS_timer_getoverrun
    case SYS_timer_getoverrun:
#endif
#ifdef SYS_timer_delete
    case SYS_timer_delete:
#endif
#ifdef SYS_getitimer
    case SYS_getitimer:
#endif
#ifdef SYS_setitimer
    case SYS_setitimer:
#endif
#ifdef SYS_alarm
    case SYS_alarm:
#endif
#ifdef SYS_signalfd
    case SYS_signalfd:
#endif
#ifdef SYS_signalfd4
    case SYS_signalfd4:
#endif
#ifdef SYS_wait4
    case SYS_wait4:
#endif
#ifdef SYS_waitid
    case SYS_waitid:
#endif
#ifdef SYS_getdents
    case SYS_getdents:
#endif
#ifdef SYS_getdents64
    case SYS_getdents64:
#endif
#ifdef SYS_recvfrom
    case SYS_recvfrom:
#endif
#ifdef SYS_recvmsg
    case SYS_recvmsg:
#endif
#ifdef SYS_recvmmsg
    case SYS_recvmmsg:
#endif
#ifdef SYS_shutdown
    case SYS_shutdown:
#endif
#ifdef SYS_getsockname
    case SYS_getsockname:
#endif
#ifdef SYS_getpeername
    case SYS_getpeername:
#endif
#ifdef SYS_flock
    case SYS_flock:
#endif
#ifdef SYS_sync
    case SYS_sync:
#endif
#ifdef SYS_umask
    case SYS_umask:
#endif
#ifdef SYS_sched_rr_get_interval
    case SYS_sched_rr_get_interval:
#endif
    return 1;
    default: return 0;
  }
}

static int needs_inspection(uint64_t nr) { return !harmless(nr); }

static int open_writes(uint64_t flags) {
  return (flags & O_ACCMODE) != O_RDONLY || (flags & (O_CREAT | O_TRUNC | O_APPEND)) ||
    (flags & O_TMPFILE) == O_TMPFILE;
}

static int inspect_open(pid_t pid, int dirfd, uint64_t pointer, uint64_t flags, uint64_t nr) {
  if (open_writes(flags)) {
    char raw[NP_MAX_PATH], resolved[NP_MAX_PATH];
    if (!string_at(pid, pointer, raw)) return deny("argument-unverifiable", nr);
    if (resolve_path(pid, dirfd, raw, resolved) && clear_refs_target(resolved)) {
      uint64_t shape = flags & ~(uint64_t) (O_CLOEXEC | O_NOFOLLOW);
      if (!registered_chromium(pid) || (shape != O_WRONLY && shape != (O_WRONLY | O_CREAT | O_TRUNC)))
        return deny("process-bookkeeping-unavailable", nr);
      clear_refs_opens++;
      return 1;
    }
    if (resolve_path(pid, dirfd, raw, resolved) && bookkeeping_target(resolved)) {
      uint64_t shape = flags & ~(uint64_t) (O_CLOEXEC | O_NOFOLLOW);
      struct np_task *task = find_task(pid);
      if (shape != O_WRONLY && shape != (O_WRONLY | O_CREAT | O_TRUNC))
        return deny("process-bookkeeping-unavailable", nr);
      task->bookkeeping_open_target = (pid_t) strtol(resolved + 6, NULL, 10);
      if (!bookkeeping_value(task->bookkeeping_open_target, &task->bookkeeping_open_value))
        return deny("process-bookkeeping-unavailable", nr);
      bookkeeping_opens++;
      return 1;
    }
  }
  if (!check_path(pid, dirfd, pointer, open_writes(flags), nr)) return 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) return charge_creation();
  return 1;
}

static int inspect_call(struct np_task *task) {
  uint64_t nr = task->call.data.entry.nr;
  uint64_t *a = task->call.data.entry.args;
  pid_t pid = task->pid;
  if (task->call.arch != NP_AUDIT_ARCH) return deny("unsupported-architecture", nr);
#ifdef SYS_shmget
  if (nr == SYS_shmget) {
    if (!registered_postgres(pid)) return deny("sysv-ipc-role", nr);
    if ((key_t) a[0] == IPC_PRIVATE || a[1] != 56 || a[2] != (IPC_CREAT | IPC_EXCL | 0600))
      return deny("sysv-ipc-shape", nr);
    if (sysv_create_attempts >= 4) { fail("sysv-ipc-limit"); return 0; }
    sysv_create_attempts++;
    task->pending_sysv_create = 1;
    task->pending_sysv_key = (key_t) a[0];
    return 1;
  }
#endif
#ifdef SYS_shmctl
  if (nr == SYS_shmctl) {
    int index = sysv_owned(pid, a[0], nr);
    if (index < 0) return 0;
    if (a[1] == IPC_STAT) return 1;
    if (a[1] == IPC_RMID && !a[2]) { task->pending_sysv_rmid = (unsigned) index + 1; return 1; }
    return deny("sysv-ipc-control", nr);
  }
#endif
#ifdef SYS_shmat
  if (nr == SYS_shmat) {
    int index = sysv_owned(pid, a[0], nr);
    if (index < 0) return 0;
    if (a[1] || a[2]) return deny("sysv-ipc-shape", nr);
    if (sysv_attach_attempts >= 128) { fail("sysv-ipc-attachment-limit"); return 0; }
    sysv_attach_attempts++;
    task->pending_sysv_attach = (unsigned) index + 1;
    return 1;
  }
#endif
#ifdef SYS_shmdt
  if (nr == SYS_shmdt) {
    size_t i;
    if (!registered_postgres(pid)) return deny("sysv-ipc-role", nr);
    for (i = 0; i < sysv_address_count; i++)
      if (sysv_addresses[i].address == a[0] && sysv_mapping(pid, a[0], sysv_addresses[i].segment)) return 1;
    return deny("sysv-ipc-foreign-address", nr);
  }
#endif
#ifdef SYS_open
  if (nr == SYS_open) { return inspect_open(pid, AT_FDCWD, a[0], a[1], nr); }
#endif
#ifdef SYS_openat
  if (nr == SYS_openat) { return inspect_open(pid, (int) a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_openat2
  if (nr == SYS_openat2) { uint64_t how[3]; if (a[3] != sizeof(how) || !memory(pid, a[2], how, sizeof(how))) return deny("argument-unverifiable", nr); return inspect_open(pid, (int) a[0], a[1], how[0], nr); }
#endif
#ifdef SYS_access
  if (nr == SYS_access) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_stat
  if (nr == SYS_stat) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_lstat
  if (nr == SYS_lstat) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_statfs
  if (nr == SYS_statfs) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_readlink
  if (nr == SYS_readlink) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_chdir
  if (nr == SYS_chdir) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_faccessat
  if (nr == SYS_faccessat) { if (!a[1]) return deny("argument-unverifiable", nr); return check_path(pid, (int) a[0], a[1], 0, nr); }
#endif
#ifdef SYS_faccessat2
  if (nr == SYS_faccessat2) { if (!a[1]) return deny("argument-unverifiable", nr); return check_path(pid, (int) a[0], a[1], 0, nr); }
#endif
#ifdef SYS_newfstatat
  if (nr == SYS_newfstatat) {
    char path[NP_MAX_PATH];
    if (!a[1] || !string_at(pid, a[1], path)) return deny("argument-unverifiable", nr);
    if (!path[0]) {
      if (a[3] & AT_EMPTY_PATH)
        return (int) a[0] == AT_FDCWD ? check_path_text(pid, AT_FDCWD, ".", 0, nr) : check_fd(pid, a[0], 0, nr);
      if ((a[3] & ~(uint64_t) (AT_SYMLINK_NOFOLLOW | AT_NO_AUTOMOUNT)) || blocked_runtime_probes >= 256)
        return deny("argument-unverifiable", nr);
      /* Empty names without AT_EMPTY_PATH cannot address any inode. Require
       * the kernel's negative metadata probe result before userspace resumes. */
      task->failure_only_probe = 5;
      return 1;
    }
    return check_path_text(pid, (int) a[0], path, 0, nr);
  }
#endif
#ifdef SYS_statx
  if (nr == SYS_statx) {
    char path[NP_MAX_PATH];
    if (!a[1] || !string_at(pid, a[1], path)) return deny("argument-unverifiable", nr);
    if (credential_path(path)) return next_env_metadata(task, path, nr);
    if (!path[0] && (a[2] & AT_EMPTY_PATH))
      return (int) a[0] == AT_FDCWD ? check_path_text(pid, AT_FDCWD, ".", 0, nr) : check_fd(pid, a[0], 0, nr);
    return check_path_text(pid, (int) a[0], path, 0, nr);
  }
#endif
#ifdef SYS_readlinkat
  if (nr == SYS_readlinkat) { if (!a[1]) return deny("argument-unverifiable", nr); return check_path(pid, (int) a[0], a[1], 0, nr); }
#endif
#ifdef SYS_mkdir
  if (nr == SYS_mkdir) { return check_path(pid, AT_FDCWD, a[0], 1, nr) && charge_creation(); }
#endif
#ifdef SYS_rmdir
  if (nr == SYS_rmdir) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_unlink
  if (nr == SYS_unlink) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_chmod
  if (nr == SYS_chmod) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_chown
  if (nr == SYS_chown) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_lchown
  if (nr == SYS_lchown) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_truncate
  if (nr == SYS_truncate) { return check_path(pid, AT_FDCWD, a[0], 1, nr) && charge_bytes(a[1]); }
#endif
#ifdef SYS_utime
  if (nr == SYS_utime) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_utimes
  if (nr == SYS_utimes) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_setxattr
  if (nr == SYS_setxattr) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_lsetxattr
  if (nr == SYS_lsetxattr) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_removexattr
  if (nr == SYS_removexattr) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_lremovexattr
  if (nr == SYS_lremovexattr) { return check_path(pid, AT_FDCWD, a[0], 1, nr); }
#endif
#ifdef SYS_mkdirat
  if (nr == SYS_mkdirat) { return check_path(pid, (int) a[0], a[1], 1, nr) && charge_creation(); }
#endif
#ifdef SYS_unlinkat
  if (nr == SYS_unlinkat) { if (!a[1]) return check_fd(pid, a[0], 1, nr); return check_path(pid, (int) a[0], a[1], 1, nr); }
#endif
#ifdef SYS_fchmodat
  if (nr == SYS_fchmodat) { if (!a[1]) return check_fd(pid, a[0], 1, nr); return check_path(pid, (int) a[0], a[1], 1, nr); }
#endif
#ifdef SYS_fchmodat2
  if (nr == SYS_fchmodat2) { if (!a[1]) return check_fd(pid, a[0], 1, nr); return check_path(pid, (int) a[0], a[1], 1, nr); }
#endif
#ifdef SYS_fchownat
  if (nr == SYS_fchownat) { if (!a[1]) return check_fd(pid, a[0], 1, nr); return check_path(pid, (int) a[0], a[1], 1, nr); }
#endif
#ifdef SYS_futimesat
  if (nr == SYS_futimesat) { if (!a[1]) return check_fd(pid, a[0], 1, nr); return check_path(pid, (int) a[0], a[1], 1, nr); }
#endif
#ifdef SYS_utimensat
  if (nr == SYS_utimensat) { if (!a[1]) return check_fd(pid, a[0], 1, nr); return check_path(pid, (int) a[0], a[1], 1, nr); }
#endif
#ifdef SYS_rename
  if (nr == SYS_rename) { return check_path(pid, AT_FDCWD, a[0], 1, nr) && check_path(pid, AT_FDCWD, a[1], 1, nr); }
#endif
#ifdef SYS_link
  if (nr == SYS_link) { return check_path(pid, AT_FDCWD, a[0], 1, nr) && check_path(pid, AT_FDCWD, a[1], 1, nr) && charge_creation(); }
#endif
#ifdef SYS_renameat
  if (nr == SYS_renameat) { return check_path(pid, (int) a[0], a[1], 1, nr) && check_path(pid, (int) a[2], a[3], 1, nr); }
#endif
#ifdef SYS_renameat2
  if (nr == SYS_renameat2) { return check_path(pid, (int) a[0], a[1], 1, nr) && check_path(pid, (int) a[2], a[3], 1, nr); }
#endif
#ifdef SYS_linkat
  if (nr == SYS_linkat) { return check_path(pid, (int) a[0], a[1], 1, nr) && check_path(pid, (int) a[2], a[3], 1, nr) && charge_creation(); }
#endif
#ifdef SYS_symlink
  if (nr == SYS_symlink) { if (!charge_creation()) return 0; char raw[NP_MAX_PATH], link[NP_MAX_PATH]; if (!string_at(pid, a[0], raw) || !string_at(pid, a[1], link)) return deny("argument-unverifiable", nr); if (!check_path_text(pid, AT_FDCWD, link, 1, nr)) return 0; if (raw[0] == '/') return check_path_text(pid, AT_FDCWD, raw, 1, nr); char resolved[NP_MAX_PATH], joined[NP_MAX_PATH]; if (!resolve_path(pid, AT_FDCWD, link, resolved)) return deny("path-unverifiable", nr); char *slash = strrchr(resolved, '/'); if (!slash) return deny("path-unverifiable", nr); *slash = 0; if (snprintf(joined, sizeof(joined), "%s/%s", resolved, raw) >= (int) sizeof(joined)) return deny("path-unverifiable", nr); return check_path_text(pid, AT_FDCWD, joined, 1, nr); }
#endif
#ifdef SYS_symlinkat
  if (nr == SYS_symlinkat) { if (!charge_creation()) return 0; char raw[NP_MAX_PATH], link[NP_MAX_PATH], resolved[NP_MAX_PATH], joined[NP_MAX_PATH]; if (!string_at(pid, a[0], raw) || !string_at(pid, a[2], link)) return deny("argument-unverifiable", nr); if (!check_path_text(pid, (int) a[1], link, 1, nr)) return 0; if (raw[0] == '/') return check_path_text(pid, AT_FDCWD, raw, 1, nr); if (!resolve_path(pid, (int) a[1], link, resolved)) return deny("path-unverifiable", nr); char *slash = strrchr(resolved, '/'); if (!slash) return deny("path-unverifiable", nr); *slash = 0; if (snprintf(joined, sizeof(joined), "%s/%s", resolved, raw) >= (int) sizeof(joined)) return deny("path-unverifiable", nr); return check_path_text(pid, AT_FDCWD, joined, 1, nr); }
#endif
#ifdef SYS_fchdir
  if (nr == SYS_fchdir) { return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_fgetxattr
  if (nr == SYS_fgetxattr) { return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_flistxattr
  if (nr == SYS_flistxattr) { return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_getxattr
  if (nr == SYS_getxattr) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_lgetxattr
  if (nr == SYS_lgetxattr) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_listxattr
  if (nr == SYS_listxattr) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_llistxattr
  if (nr == SYS_llistxattr) { return check_path(pid, AT_FDCWD, a[0], 0, nr); }
#endif
#ifdef SYS_write
  if (nr == SYS_write) { return inspect_write(task, a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_writev
  if (nr == SYS_writev) { return inspect_writev(pid, a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_pwrite64
  if (nr == SYS_pwrite64) { return opaque_destination(pid, a[0], nr) && check_fd(pid, a[0], 1, nr) && charge_fd(pid, a[0], a[2], nr); }
#endif
#ifdef SYS_pwritev
  if (nr == SYS_pwritev) { return opaque_destination(pid, a[0], nr) && inspect_writev(pid, a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_pwritev2
  if (nr == SYS_pwritev2) { return opaque_destination(pid, a[0], nr) && inspect_writev(pid, a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_ftruncate
  if (nr == SYS_ftruncate) { return check_fd(pid, a[0], 1, nr) && charge_fd(pid, a[0], a[1], nr); }
#endif
#ifdef SYS_fallocate
  if (nr == SYS_fallocate) { return check_fd(pid, a[0], 1, nr) && charge_fd(pid, a[0], a[3], nr); }
#endif
#ifdef SYS_fchmod
  if (nr == SYS_fchmod) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_fchown
  if (nr == SYS_fchown) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_fsetxattr
  if (nr == SYS_fsetxattr) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_fremovexattr
  if (nr == SYS_fremovexattr) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_syncfs
  if (nr == SYS_syncfs) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_fadvise64
  if (nr == SYS_fadvise64) {
    char target[NP_MAX_PATH], proc[100];
    struct stat st;
    /* The fixed PostgreSQL server prefetches owned database pages. This exact
     * bounded WILLNEED hint can only read an already open regular output inode;
     * it grants no source/cache eviction or additional path authority. Keep all
     * fd-table writers stopped through completion, as for other inspected I/O. */
    if (!registered_postgres(pid)) return deny("file-advice-role", nr);
    if (a[3] != POSIX_FADV_WILLNEED || !a[2] || a[2] > 16777216ULL ||
        a[1] > 268435456ULL || a[2] > 268435456ULL - a[1])
      return deny("file-advice-shape", nr);
    if (a[0] > INT_MAX || !fd_target(pid, (int) a[0], target) || !beneath(target, output_root))
      return deny("file-advice-target", nr);
    snprintf(proc, sizeof(proc), "/proc/%ld/fd/%d", (long) pid, (int) a[0]);
    if (stat(proc, &st) || !S_ISREG(st.st_mode)) return deny("file-advice-target", nr);
    return check_fd(pid, a[0], 0, nr);
  }
#endif
#ifdef SYS_sync_file_range
  if (nr == SYS_sync_file_range) {
    char target[NP_MAX_PATH], proc[100];
    struct stat st;
    /* Only the measured PostgreSQL flush of already charged output pages is
     * admitted. This does not allocate data or replace the driver's fsync gate. */
    if (!registered_postgres(pid)) return deny("file-sync-role", nr);
    if (a[3] != SYNC_FILE_RANGE_WRITE || !a[2] || a[2] > 16777216ULL ||
        a[1] > 268435456ULL || a[2] > 268435456ULL - a[1])
      return deny("file-sync-shape", nr);
    if (a[0] > INT_MAX || !fd_target(pid, (int) a[0], target) || !beneath(target, output_root))
      return deny("file-sync-target", nr);
    snprintf(proc, sizeof(proc), "/proc/%ld/fd/%d", (long) pid, (int) a[0]);
    if (stat(proc, &st) || !S_ISREG(st.st_mode)) return deny("file-sync-target", nr);
    return check_fd(pid, a[0], 1, nr);
  }
#endif
#ifdef SYS_fsync
  if (nr == SYS_fsync) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_fdatasync
  if (nr == SYS_fdatasync) { return check_fd(pid, a[0], 1, nr); }
#endif
#ifdef SYS_sendfile
  if (nr == SYS_sendfile) { return opaque_destination(pid, a[0], nr) && check_fd(pid, a[0], 1, nr) && check_fd(pid, a[1], 0, nr) && charge_fd(pid, a[0], a[3], nr); }
#endif
#ifdef SYS_splice
  if (nr == SYS_splice) { return opaque_destination(pid, a[2], nr) && check_fd(pid, a[0], 0, nr) && check_fd(pid, a[2], 1, nr) && charge_fd(pid, a[2], a[4], nr); }
#endif
#ifdef SYS_copy_file_range
  if (nr == SYS_copy_file_range) { return opaque_destination(pid, a[2], nr) && check_fd(pid, a[0], 0, nr) && check_fd(pid, a[2], 1, nr) && charge_fd(pid, a[2], a[4], nr); }
#endif
#ifdef SYS_tee
  if (nr == SYS_tee) { return opaque_destination(pid, a[1], nr) && check_fd(pid, a[0], 0, nr) && check_fd(pid, a[1], 1, nr) && charge_fd(pid, a[1], a[2], nr); }
#endif
#ifdef SYS_vmsplice
  if (nr == SYS_vmsplice) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_mmap
  if (nr == SYS_mmap) { if ((a[3] & MAP_SHARED) && !(a[3] & MAP_ANONYMOUS)) return check_fd(pid, a[4], (a[2] & PROT_WRITE) != 0, nr); return 1; }
#endif
#ifdef SYS_mprotect
  if (nr == SYS_mprotect) { return protect_mapping(pid, a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_pkey_mprotect
  if (nr == SYS_pkey_mprotect) { return protect_mapping(pid, a[0], a[1], a[2], nr); }
#endif
#ifdef SYS_socket
  if (nr == SYS_socket) { task->pending_socket = 1; if ((a[0] == AF_INET || a[0] == AF_INET6) && (a[1] & 0xf) == SOCK_DGRAM) { if (blocked_runtime_probes >= 256) return deny("socket-family-unavailable", nr); task->failure_only_probe = a[0] == AF_INET6 ? 2 : 3; return 1; } if (a[0] == AF_NETLINK && (a[2] == NETLINK_ROUTE || a[2] == NETLINK_KOBJECT_UEVENT) && ((a[1] & 0xf) == SOCK_RAW || (a[1] & 0xf) == SOCK_DGRAM)) { task->pending_netlink = (unsigned) a[2] + 1; return 1; } if ((a[0] == AF_INET || a[0] == AF_INET6 || a[0] == AF_UNIX) && ((a[1] & 0xf) == SOCK_STREAM || (a[1] & 0xf) == SOCK_DGRAM || (a[1] & 0xf) == SOCK_SEQPACKET)) return 1; return deny("socket-family-unavailable", nr); }
#endif
#ifdef SYS_socketpair
  if (nr == SYS_socketpair) { task->pending_socketpair = a[3]; if (a[0] == AF_UNIX && ((a[1] & 0xf) == SOCK_STREAM || (a[1] & 0xf) == SOCK_DGRAM || (a[1] & 0xf) == SOCK_SEQPACKET)) return 1; return deny("socket-family-unavailable", nr); }
#endif
#ifdef SYS_connect
  if (nr == SYS_connect) { struct np_netlink_socket *record = socket_record(pid, a[0], 1); if (!record) return 0; record->bound = 0; int route = route_socket(pid, a[0], nr); if (route < 0) return 0; if (route == 2) return deny("read-only-channel-write", nr); return endpoint(pid, a[1], a[2], nr); }
#endif
#ifdef SYS_bind
  if (nr == SYS_bind) { int route = route_socket(pid, a[0], nr); if (route < 0) return 0; if (route == 2) { struct sockaddr_nl address; if (a[2] != sizeof(address) || !memory(pid, a[1], &address, sizeof(address)) || address.nl_family != AF_NETLINK || (address.nl_groups & ~3U)) return deny("network-unverifiable", nr); } if (!endpoint(pid, a[1], a[2], nr)) return 0; uint16_t family; if (!memory(pid, a[1], &family, sizeof(family))) return deny("argument-unverifiable", nr); if (family == AF_INET || family == AF_INET6 || family == AF_UNIX) task->pending_bind = (unsigned) a[0] + 1; return 1; }
#endif
#ifdef SYS_sendto
  if (nr == SYS_sendto) { int route; if ((a[4] || a[5]) && !endpoint(pid, a[4], a[5], nr)) return 0; route = route_socket(pid, a[0], nr); if (route < 0) return 0; if (route == 2) return deny("read-only-channel-write", nr); return !route || route_payload(pid, a[1], a[2], nr); }
#endif
#ifdef SYS_sendmsg
  if (nr == SYS_sendmsg) { return message_endpoint(pid, a[0], a[1], nr); }
#endif
#ifdef SYS_sendmmsg
  if (nr == SYS_sendmmsg) { size_t i; if (!a[2] || a[2] > 64) return deny("network-unverifiable", nr); for (i = 0; i < a[2]; i++) if (!message_endpoint(pid, a[0], a[1] + i * sizeof(struct mmsghdr), nr)) return 0; return 1; }
#endif
#ifdef SYS_getsockopt
  if (nr == SYS_getsockopt) { return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_setsockopt
  if (nr == SYS_setsockopt) { return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_listen
  if (nr == SYS_listen) {
    struct np_netlink_socket *record = socket_record(pid, a[0], 0);
    if (failed) return 0;
    return record && record->bound ? 1 : deny("implicit-network-bind", nr);
  }
#endif
#ifdef SYS_accept
  if (nr == SYS_accept) { task->pending_socket = 1; return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_accept4
  if (nr == SYS_accept4) { task->pending_socket = 1; return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_execve
  if (nr == SYS_execve) { return execution(pid, a[0], a[1], nr); }
#endif
#ifdef SYS_capget
  if (nr == SYS_capget) {
    struct __user_cap_header_struct header;
    if (!memory(pid, a[0], &header, sizeof(header))) return deny("argument-unverifiable", nr);
    if (header.pid && !find_task(header.pid)) return deny("external-process-access", nr);
    return 1;
  }
#endif
#ifdef SYS_landlock_create_ruleset
  if (nr == SYS_landlock_create_ruleset) {
    if (!a[0] && !a[1] && a[2] == 1) return 1;
    return deny("privileged-operation", nr);
  }
#endif
#ifdef SYS_execveat
  if (nr == SYS_execveat) { return deny("unregistered-executable", nr); }
#endif
#ifdef SYS_clone
  if (nr == SYS_clone) { return clone_flags(a[0], nr); }
#endif
#ifdef SYS_clone3
  if (nr == SYS_clone3) { struct clone_args args; if (a[1] < 64 || a[1] > sizeof(args)) return deny("argument-unverifiable", nr); memset(&args, 0, sizeof(args)); if (!memory(pid, a[0], &args, (size_t) a[1]) || args.set_tid_size || args.cgroup) return deny("process-escape", nr); return clone_flags(args.flags, nr); }
#endif
#ifdef SYS_fork
  if (nr == SYS_fork) { return 1; }
#endif
#ifdef SYS_vfork
  if (nr == SYS_vfork) { return 1; }
#endif
#ifdef SYS_exit
  if (nr == SYS_exit) { return 1; }
#endif
#ifdef SYS_exit_group
  /* Group teardown can invalidate a peer's queued syscall stop. Freeze and
   * observe every peer before entering the kernel; the owner's EXIT event
   * releases this non-returning call without dropping observation evidence. */
  if (nr == SYS_exit_group) { return 1; }
#endif
#ifdef SYS_kill
  if (nr == SYS_kill) { return process_signal(a[0], nr); }
#endif
#ifdef SYS_tkill
  if (nr == SYS_tkill) { if (a[0] > INT_MAX || !find_task((pid_t) a[0])) return deny("external-process-signal", nr); return 1; }
#endif
#ifdef SYS_tgkill
  if (nr == SYS_tgkill) { if (a[0] > INT_MAX || a[1] > INT_MAX || !find_task((pid_t) a[0]) || !find_task((pid_t) a[1])) return deny("external-process-signal", nr); return 1; }
#endif
#ifdef SYS_sched_getaffinity
  if (nr == SYS_sched_getaffinity) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_sched_setaffinity
  if (nr == SYS_sched_setaffinity) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_sched_getparam
  if (nr == SYS_sched_getparam) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_sched_getscheduler
  if (nr == SYS_sched_getscheduler) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_sched_getattr
  if (nr == SYS_sched_getattr) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_sched_setattr
  if (nr == SYS_sched_setattr) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_getpgid
  if (nr == SYS_getpgid) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_getsid
  if (nr == SYS_getsid) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_get_robust_list
  if (nr == SYS_get_robust_list) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_prlimit64
  if (nr == SYS_prlimit64) { if (a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_getrusage
  if (nr == SYS_getrusage) { if ((int64_t) a[0] != RUSAGE_SELF && (int64_t) a[0] != RUSAGE_CHILDREN && (int64_t) a[0] != RUSAGE_THREAD) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_getpriority
  if (nr == SYS_getpriority) { if (a[0] != PRIO_PROCESS || (a[1] && (a[1] > INT_MAX || !find_task((pid_t) a[1])))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_setpriority
  if (nr == SYS_setpriority) {
    int current;
    int requested = (int32_t) a[2];
    pid_t target = a[1] ? (pid_t) a[1] : pid;
    if (a[0] != PRIO_PROCESS || a[1] > INT_MAX || !find_task(target) || requested < -20 || requested > 19)
      return deny("process-priority-decrease", nr);
    if (requested < 0) {
      if (!registered_chromium(pid) || !registered_chromium(target)) return deny("process-priority-decrease", nr);
      if (blocked_runtime_probes >= 256) return deny("process-priority-decrease", nr);
      /* No CAP_SYS_NICE and hard RLIMIT_NICE=0: Chrome's optional high-priority
       * hint must fail. A successful result is never allowed into userspace. */
      task->failure_only_probe = 1;
      return 1;
    }
    errno = 0;
    current = getpriority(PRIO_PROCESS, target);
    if (errno || requested < current) return deny("process-priority-decrease", nr);
    return 1;
  }
#endif
#ifdef SYS_getrlimit
  if (nr == SYS_getrlimit) { return 1; }
#endif
#ifdef SYS_setrlimit
  if (nr == SYS_setrlimit) { return 1; }
#endif
#ifdef SYS_setpgid
  if (nr == SYS_setpgid) { if ((a[0] && (a[0] > INT_MAX || !find_task((pid_t) a[0]))) || (a[1] && (a[1] > INT_MAX || !find_task((pid_t) a[1])))) return deny("external-process-access", nr); return 1; }
#endif
#ifdef SYS_setsid
  if (nr == SYS_setsid) { return 1; }
#endif
#ifdef SYS_fcntl
  if (nr == SYS_fcntl) {
    switch (a[1]) {
      /* Node probes invalid descriptors at startup. These closed operations
       * have no effect on a file or foreign process, even for an invalid fd. */
      case F_GETFD: case F_SETFD: case F_GETFL: case F_GETOWN:
      case F_DUPFD: case F_DUPFD_CLOEXEC: return 1;
      case F_SETFL:
        if (a[2] & O_ASYNC) return deny("asynchronous-memory-operation", nr);
        return 1;
      case F_GETLK: case F_SETLK: case F_SETLKW: case F_OFD_GETLK:
      case F_OFD_SETLK: case F_OFD_SETLKW: case F_GET_SEALS: case F_ADD_SEALS:
      case F_GETPIPE_SZ: case F_SETPIPE_SZ: return check_fd(pid, a[0], 0, nr);
      default: return deny("descriptor-control-unavailable", nr);
    }
  }
#endif
#ifdef SYS_ioctl
  if (nr == SYS_ioctl) {
    /* SQLite probes F2FS_IOC_GET_FEATURES: a read-only u32 filesystem feature
     * query. No generic ioctl direction-bit or device-command allow exists. */
    if (a[1] == FIONBIO || a[1] == FIONREAD || a[1] == TCGETS || a[1] == TIOCGWINSZ ||
        a[1] == FIOCLEX || a[1] == FIONCLEX || a[1] == 0x8004f50cULL) return check_fd(pid, a[0], 0, nr);
    return deny("ioctl-unavailable", nr);
  }
#endif
#ifdef SYS_prctl
  if (nr == SYS_prctl) { switch (a[0]) { case PR_GET_DUMPABLE: case PR_SET_NAME: case PR_GET_NAME: case PR_GET_PDEATHSIG: case PR_GET_NO_NEW_PRIVS: case PR_GET_SECCOMP: case PR_CAPBSET_READ: case PR_SVE_GET_VL: case PR_SME_GET_VL: case PR_GET_CHILD_SUBREAPER: case PR_SET_VMA: return 1; case PR_SET_DUMPABLE: return a[1] <= 1 ? 1 : deny("process-escape", nr); case PR_SET_PDEATHSIG: return a[1] <= (uint64_t) SIGRTMAX ? 1 : deny("process-escape", nr); case PR_SET_NO_NEW_PRIVS: return a[1] == 1 ? 1 : deny("process-escape", nr); case PR_GET_SECUREBITS: return !a[1] && !a[2] && !a[3] && !a[4] ? 1 : deny("process-control-unavailable", nr); case PR_CAP_AMBIENT: return a[1] == PR_CAP_AMBIENT_IS_SET && a[2] <= CAP_LAST_CAP && !a[3] && !a[4] ? 1 : deny("process-control-unavailable", nr); default: return deny("process-control-unavailable", nr); } }
#endif
#ifdef SYS_personality
  if (nr == SYS_personality) { return a[0] == 0xffffffffU ? 1 : deny("process-control-unavailable", nr); }
#endif
#ifdef SYS_ptrace
  if (nr == SYS_ptrace) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_process_vm_readv
  if (nr == SYS_process_vm_readv) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_process_vm_writev
  if (nr == SYS_process_vm_writev) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_pidfd_open
  if (nr == SYS_pidfd_open) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_pidfd_getfd
  if (nr == SYS_pidfd_getfd) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_pidfd_send_signal
  if (nr == SYS_pidfd_send_signal) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_process_madvise
  if (nr == SYS_process_madvise) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_process_mrelease
  if (nr == SYS_process_mrelease) { return deny("external-process-access", nr); }
#endif
#ifdef SYS_io_uring_setup
  if (nr == SYS_io_uring_setup) { return node_runtime_probe(task, nr); }
#endif
#ifdef SYS_io_uring_enter
  if (nr == SYS_io_uring_enter) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_uring_register
  if (nr == SYS_io_uring_register) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_setup
  if (nr == SYS_io_setup) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_submit
  if (nr == SYS_io_submit) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_cancel
  if (nr == SYS_io_cancel) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_destroy
  if (nr == SYS_io_destroy) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_getevents
  if (nr == SYS_io_getevents) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_io_pgetevents
  if (nr == SYS_io_pgetevents) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_userfaultfd
  if (nr == SYS_userfaultfd) { return deny("asynchronous-memory-operation", nr); }
#endif
#ifdef SYS_mount
  if (nr == SYS_mount) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_umount2
  if (nr == SYS_umount2) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_pivot_root
  if (nr == SYS_pivot_root) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_chroot
  if (nr == SYS_chroot) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_unshare
  if (nr == SYS_unshare) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setns
  if (nr == SYS_setns) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_open_tree
  if (nr == SYS_open_tree) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_move_mount
  if (nr == SYS_move_mount) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_fsopen
  if (nr == SYS_fsopen) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_fsconfig
  if (nr == SYS_fsconfig) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_fsmount
  if (nr == SYS_fsmount) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_fspick
  if (nr == SYS_fspick) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_mount_setattr
  if (nr == SYS_mount_setattr) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setuid
  if (nr == SYS_setuid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setgid
  if (nr == SYS_setgid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setresuid
  if (nr == SYS_setresuid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setresgid
  if (nr == SYS_setresgid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setreuid
  if (nr == SYS_setreuid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setregid
  if (nr == SYS_setregid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setgroups
  if (nr == SYS_setgroups) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setfsuid
  if (nr == SYS_setfsuid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setfsgid
  if (nr == SYS_setfsgid) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_capset
  if (nr == SYS_capset) {
    struct __user_cap_header_struct header;
    struct __user_cap_data_struct data[2], zero[2];
    memset(zero, 0, sizeof(zero));
    if (!memory(pid, a[0], &header, sizeof(header)) || header.version != _LINUX_CAPABILITY_VERSION_3 ||
        (header.pid && header.pid != pid) || !memory(pid, a[1], &data, sizeof(data)) || memcmp(data, zero, sizeof(data)))
      return deny("privileged-operation", nr);
    return 1;
  }
#endif
#ifdef SYS_seccomp
  if (nr == SYS_seccomp) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_bpf
  if (nr == SYS_bpf) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_perf_event_open
  if (nr == SYS_perf_event_open) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_kexec_load
  if (nr == SYS_kexec_load) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_kexec_file_load
  if (nr == SYS_kexec_file_load) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_reboot
  if (nr == SYS_reboot) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_syslog
  if (nr == SYS_syslog) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_add_key
  if (nr == SYS_add_key) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_request_key
  if (nr == SYS_request_key) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_keyctl
  if (nr == SYS_keyctl) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_iopl
  if (nr == SYS_iopl) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_ioperm
  if (nr == SYS_ioperm) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_swapon
  if (nr == SYS_swapon) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_swapoff
  if (nr == SYS_swapoff) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_acct
  if (nr == SYS_acct) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_quotactl
  if (nr == SYS_quotactl) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_mknod
  if (nr == SYS_mknod) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_mknodat
  if (nr == SYS_mknodat) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_name_to_handle_at
  if (nr == SYS_name_to_handle_at) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_open_by_handle_at
  if (nr == SYS_open_by_handle_at) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_fanotify_init
  if (nr == SYS_fanotify_init) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_fanotify_mark
  if (nr == SYS_fanotify_mark) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_inotify_init
  if (nr == SYS_inotify_init) { return 1; }
#endif
#ifdef SYS_inotify_init1
  if (nr == SYS_inotify_init1) { return (a[0] & ~(uint64_t) (IN_NONBLOCK | IN_CLOEXEC)) ? deny("descriptor-control-unavailable", nr) : 1; }
#endif
#ifdef SYS_inotify_add_watch
  if (nr == SYS_inotify_add_watch) { return check_fd(pid, a[0], 0, nr) && check_path(pid, AT_FDCWD, a[1], 0, nr); }
#endif
#ifdef SYS_inotify_rm_watch
  if (nr == SYS_inotify_rm_watch) { return check_fd(pid, a[0], 0, nr); }
#endif
#ifdef SYS_sethostname
  if (nr == SYS_sethostname) { return deny("privileged-operation", nr); }
#endif
#ifdef SYS_setdomainname
  if (nr == SYS_setdomainname) { return deny("privileged-operation", nr); }
#endif
  return deny("unsupported-syscall", nr);
}

/* An EXIT event precedes kernel teardown; only an actual zombie has completed
 * exit_mm/clear_child_tid and exit_notify's parent-death/orphan-group signals.
 * SIGKILL may skip the EXIT ptrace stop. A known live TID can therefore already
 * be a zombie without task->exiting. This observation only makes it quiescent
 * for argument freezing. Terminal waitpid observations still own retirement.
 */
static int pending_exit_effect(const struct np_task *task) {
  return task->write_interrupt_requested || task->failure_only_probe || task->pending_next_exec || task->synthetic_next_env ||
    task->pending_sysv_create || task->pending_sysv_attach || task->pending_sysv_rmid ||
    task->pending_netlink || task->pending_socket || task->pending_bind || task->pending_socketpair ||
    task->bookkeeping_write_length || task->bookkeeping_open_target || task->clear_refs_write;
}

static int kernel_quiescent(struct np_task *task) {
  char path[80], line[8192], *end, *close;
  FILE *stat;
  size_t bytes;
  long pid;
  uint64_t now;
  if (!task->alive || task->stopped || find_task(task->pid) != task) return 0;
  if (task->kernel_quiescent) return 1;
  /* A delayed leader has no new terminal wait until its final thread exits.
   * The existing timer retries this observation. Bound proc reads rather than
   * polling once for every unrelated syscall stop. A negative cache never
   * grants permission to resume a task or to skip freezing it. */
  now = now_ms();
  if (task->quiescence_checked_ms && now - task->quiescence_checked_ms < 100) return 0;
  task->quiescence_checked_ms = now;
  snprintf(path, sizeof(path), "/proc/%ld/stat", (long) task->pid);
  stat = fopen(path, "r");
  if (!stat) return 0;
  bytes = fread(line, 1, sizeof(line) - 1, stat);
  if (ferror(stat) || !feof(stat) || !bytes) { fclose(stat); return 0; }
  fclose(stat);
  line[bytes] = 0;
  errno = 0;
  pid = strtol(line, &end, 10);
  if (errno || pid != task->pid || end[0] != ' ' || end[1] != '(') return 0;
  close = strrchr(end, ')');
  if (!close || close[1] != ' ' || close[2] != 'Z' || close[3] != ' ') return 0;
  if (pending_exit_effect(task)) { fail("syscall-exit-unverifiable"); return 0; }
  if (task->inspect && !task->control_checked) { fail("syscall-entry-unverifiable"); return 0; }
  task->kernel_quiescent = 1;
  return 1;
}

static int scalar_control_entry(const struct np_task *task) {
  uint64_t nr;
  if (!task->inspect || task->call.op != PTRACE_SYSCALL_INFO_ENTRY) return 0;
  nr = task->call.data.entry.nr;
#ifdef SYS_exit
  if (nr == SYS_exit) return 1;
#endif
#ifdef SYS_exit_group
  if (nr == SYS_exit_group) return 1;
#endif
#ifdef SYS_kill
  if (nr == SYS_kill) return 1;
#endif
#ifdef SYS_tkill
  if (nr == SYS_tkill) return 1;
#endif
#ifdef SYS_tgkill
  if (nr == SYS_tgkill) return 1;
#endif
  return 0;
}

static struct np_task *pending_data_entry(void) {
  size_t i;
  for (i = 0; i < used_tasks; i++)
    if (tasks[i].alive && tasks[i].stopped && !tasks[i].exiting && tasks[i].inspect &&
        !scalar_control_entry(&tasks[i])) return &tasks[i];
  return NULL;
}

static int control_intents_observed(void) {
  size_t i;
  for (i = 0; i < used_tasks; i++) {
    struct np_task *task = &tasks[i];
    if (task->alive && task->stopped && !task->exiting && scalar_control_entry(task)) {
      if (pending_exit_effect(task)) { fail("syscall-exit-unverifiable"); return 0; }
      /* These exact scalar checks have no rewrites, counters or deferred
       * effects. A fatal handoff must not erase another already observed
       * signal/exit intent. Keep inspect set and repeat the current check
       * immediately before actual execution; this is not future authority. */
      if (!inspect_call(task)) return 0;
      if (pending_exit_effect(task)) { fail("syscall-exit-unverifiable"); return 0; }
      task->control_checked = 1;
    }
  }
  return 1;
}

static int interruptible_write_entry(const struct np_task *task) {
  uint64_t nr;
  if (task->call.op != PTRACE_SYSCALL_INFO_ENTRY) return 0;
  nr = task->call.data.entry.nr;
#ifdef SYS_write
  if (nr == SYS_write) return 1;
#endif
#ifdef SYS_writev
  if (nr == SYS_writev) return 1;
#endif
#ifdef SYS_sendto
  if (nr == SYS_sendto) return 1;
#endif
#ifdef SYS_sendmsg
  if (nr == SYS_sendmsg) return 1;
#endif
#ifdef SYS_sendmmsg
  if (nr == SYS_sendmmsg) return 1;
#endif
  return 0;
}

static int resume_task(struct np_task *task) {
  int signal = task->signal;
  if (!task->alive || !task->stopped) return 1;
  /* Only an actually observed, reconciled EXIT can establish this hold.
   * Let readers return to userspace before the writer's immediate restart
   * freezes them again. The writer remains stopped and receives no authority. */
  if (task->write_yield_until_ms) {
    if (now_ms() < task->write_yield_until_ms) return 1;
    task->write_yield_until_ms = 0;
  }
  task->write_resumed_ms = 0;
  if (exclusive_pid == task->pid && !task->inspect && !task->exiting && !signal &&
      !task->signal_in_flight && interruptible_write_entry(task))
    task->write_resumed_ms = now_ms();
  task->signal = 0;
  if (signal) task->signal_in_flight = 1;
  if (task->exiting) task->exit_started = 1;
  task->stopped = 0;
  task->interrupt_sent = 0;
  if (ptrace(PTRACE_SYSCALL, task->pid, NULL, (void *) (intptr_t) signal) == -1) {
    if (errno == ESRCH) return 1;
    fail("trace-resume");
    return 0;
  }
  return 1;
}

static void schedule(void) {
  size_t i;
  struct np_task *owner, *pending;
  int draining = 0;
  if (failed) return;
  /* A child's initial stop can precede its parent's creation event. */
  for (i = 0; i < used_tasks; i++)
    if (tasks[i].alive && !tasks[i].creation_seen) return;
  for (i = 0; i < used_tasks; i++)
    if (tasks[i].alive && tasks[i].exiting && tasks[i].exit_started && !tasks[i].stopped &&
        !kernel_quiescent(&tasks[i])) draining = 1;
  if (failed) return;
  if (draining) {
    /* Only known EXIT stops may advance while teardown can still deliver
     * parent-death signals or write clear_child_tid. No ordinary peer resumes. */
    if (pending_data_entry()) { fail("syscall-entry-unverifiable"); return; }
    for (i = 0; i < used_tasks; i++) {
      if (tasks[i].alive && tasks[i].stopped && tasks[i].exiting) {
        if (pending_exit_effect(&tasks[i])) { fail("syscall-exit-unverifiable"); return; }
        tasks[i].inspect = 0;
        if (!resume_task(&tasks[i])) return;
      }
    }
    return;
  }
  if (exclusive_pid) {
    owner = find_task(exclusive_pid);
    if (!owner) { fail("trace-owner-missing"); return; }
    if (!owner->stopped && kernel_quiescent(owner)) exclusive_pid = 0;
    if (failed) return;
    /* A blocking pipe/socket write must not wait forever on a frozen reader.
     * Interrupt only this known, inspected write. Keep all argument sharers
     * frozen and retain ownership until an actual syscall EXIT is observed.
     * EVENT_STOP, a request, ESRCH or terminal status never replaces its EXIT
     * effects. A restarted ENTRY goes through the normal fresh policy check. */
    if (exclusive_pid && !owner->stopped && owner->write_resumed_ms &&
        !owner->interrupt_sent && now_ms() - owner->write_resumed_ms >= 100) {
      int result = ptrace(PTRACE_INTERRUPT, owner->pid, NULL, NULL);
      if (result == -1 && errno != ESRCH) { fail("trace-write-interrupt"); return; }
      if (!result) { blocking_write_interrupts++; owner->write_interrupt_requested = 1; }
      owner->interrupt_sent = 1;
    }
  }
  if (!exclusive_pid) {
    pending = pending_data_entry();
    if (pending) exclusive_pid = pending->pid;
    if (!exclusive_pid) {
      for (i = 0; i < used_tasks; i++) {
        if (tasks[i].alive && tasks[i].stopped && !tasks[i].exiting && tasks[i].inspect) {
          exclusive_pid = tasks[i].pid;
          break;
        }
      }
    }
    if (!exclusive_pid) {
      for (i = 0; i < used_tasks; i++) {
        if (tasks[i].alive && tasks[i].stopped && (tasks[i].exiting || tasks[i].signal)) {
          exclusive_pid = tasks[i].pid;
          break;
        }
      }
    }
  }
select_owner:
  if (exclusive_pid) {
    owner = find_task(exclusive_pid);
    if (!owner) { fail("trace-owner-missing"); return; }
    for (i = 0; i < used_tasks; i++) {
      struct np_task *other = &tasks[i];
      if (!other->alive || other->pid == exclusive_pid || other->stopped || kernel_quiescent(other)) continue;
      if (failed) return;
      if (!other->interrupt_sent) {
        if (ptrace(PTRACE_INTERRUPT, other->pid, NULL, NULL) == -1 && errno != ESRCH) {
          fail("trace-freeze"); return;
        }
        other->interrupt_sent = 1;
      }
    }
    for (i = 0; i < used_tasks; i++)
      if (tasks[i].alive && tasks[i].pid != exclusive_pid && !tasks[i].stopped && !tasks[i].vfork_child &&
          !kernel_quiescent(&tasks[i])) return;
    if (failed) return;
    if (owner->stopped) {
      if (owner->exiting || owner->signal || scalar_control_entry(owner)) {
        /* Interrupting running peers may reveal more ENTRY stops. Finish
         * those policy observations before any signal or exit can erase them. */
        pending = pending_data_entry();
        if (pending && pending != owner) { exclusive_pid = pending->pid; goto select_owner; }
        if (!control_intents_observed()) return;
      }
      if (owner->exiting) {
        if (pending_exit_effect(owner)) { fail("syscall-exit-unverifiable"); return; }
        owner->inspect = 0;
        if (!resume_task(owner)) return;
        exclusive_pid = 0;
      } else {
        if (owner->inspect) {
          if (!inspect_call(owner)) return;
          owner->inspect = 0;
        }
        resume_task(owner);
      }
    }
    return;
  }
  for (i = 0; i < used_tasks; i++)
    if (tasks[i].alive && tasks[i].stopped) resume_task(&tasks[i]);
}

static void observe(pid_t pid, int status) {
  struct np_task *task = find_task(pid);
  unsigned event;
  int stop_signal;
  if (!task && WIFSTOPPED(status) && ((unsigned) status >> 16) == PTRACE_EVENT_STOP)
    task = add_task(pid);
  if (!task && (WIFEXITED(status) || WIFSIGNALED(status))) {
    size_t i;
    /* A traced grandchild can report its terminal wait once to its ptracer,
     * then again after adoption by this subreaper. Admit only the exact second
     * terminal notification, never a new task/stop or changed exit status. */
    for (i = 0; i < used_tasks; i++) {
      if (tasks[i].pid == pid && !tasks[i].alive && tasks[i].terminal_waits == 1 && tasks[i].terminal_status == status) {
        tasks[i].terminal_waits++;
        terminal_waits++;
        return;
      }
    }
  }
  if (!task) { fail("unexpected-descendant"); return; }
  if (WIFEXITED(status) || WIFSIGNALED(status)) {
    if (pending_exit_effect(task)) fail("syscall-exit-unverifiable");
    if (task->inspect && !task->control_checked) fail("syscall-entry-unverifiable");
    task->alive = 0;
    task->terminal_status = status;
    task->terminal_waits = 1;
    terminal_waits++;
    task->stopped = 0;
    live_tasks--;
    reaped_tasks++;
    if (exclusive_pid == pid) exclusive_pid = 0;
    if (pid == root_pid) {
      root_reaped = 1;
      root_finished_ms = now_ms();
      if (WIFEXITED(status)) root_exit = WEXITSTATUS(status);
      if (WIFSIGNALED(status)) root_signal = WTERMSIG(status);
      if (root_exit != 0 || root_signal) fail("driver-exit");
    }
    return;
  }
  if (!WIFSTOPPED(status)) { fail("unexpected-trace-state"); return; }
  task->stopped = 1;
  task->interrupt_sent = 0;
  event = (unsigned) status >> 16;
  stop_signal = WSTOPSIG(status);
  if (event == PTRACE_EVENT_FORK || event == PTRACE_EVENT_VFORK || event == PTRACE_EVENT_CLONE) {
    unsigned long child = 0;
    if (ptrace(PTRACE_GETEVENTMSG, pid, NULL, &child) == -1 || child > INT_MAX || !add_task((pid_t) child)) {
      fail("trace-descendant"); return;
    }
    find_task((pid_t) child)->creation_seen = 1;
    if (task->next_tgid && task_tgid((pid_t) child) == task->next_tgid) find_task((pid_t) child)->next_tgid = task->next_tgid;
    if (event == PTRACE_EVENT_VFORK) task->vfork_child = (pid_t) child;
    /* clone's arguments are already copied by the kernel. Releasing here is
     * necessary for vfork: its parent cannot return until the child execs. */
    if (exclusive_pid == pid) exclusive_pid = 0;
    return;
  }
  if (event == PTRACE_EVENT_EXEC) {
    unsigned long old = 0;
    if (ptrace(PTRACE_GETEVENTMSG, pid, NULL, &old) == -1 || (old && old != (unsigned long) pid))
      fail("thread-exec-unsupported");
    task->next_tgid = task->pending_next_exec ? pid : 0;
    task->pending_next_exec = 0;
    return;
  }
  if (event == PTRACE_EVENT_VFORK_DONE) {
    unsigned long child = 0;
    if (!task->vfork_child || ptrace(PTRACE_GETEVENTMSG, pid, NULL, &child) == -1 ||
        child != (unsigned long) task->vfork_child) { fail("vfork-state-unverifiable"); return; }
    task->vfork_child = 0;
    return;
  }
  if (event == PTRACE_EVENT_EXIT) {
    task->exiting = 1;
    task->signal_in_flight = 0;
    /* A fatal signal can skip the preceding syscall-exit stop. Never replace
     * an unknown outcome or unexamined ENTRY intent with terminal evidence. */
    if (pending_exit_effect(task)) { fail("syscall-exit-unverifiable"); return; }
    if (task->inspect && !task->control_checked) { fail("syscall-entry-unverifiable"); return; }
    if (exclusive_pid == pid) exclusive_pid = 0;
    return;
  }
  if (event == PTRACE_EVENT_STOP) return;
  if (event) { fail("unexpected-trace-event"); return; }
  if (stop_signal == (SIGTRAP | 0x80)) {
    long bytes;
    memset(&task->call, 0, sizeof(task->call));
    errno = 0;
    bytes = ptrace(PTRACE_GET_SYSCALL_INFO, pid, sizeof(task->call), &task->call);
    /* Preserve a closed failure category without exposing tracee memory or
     * local paths. A vanished task still fails closed; a later terminal wait
     * is not evidence that this syscall stop was actually inspected. */
    if (bytes < 0) { fail(errno == ESRCH ? "syscall-observation-vanished" : "syscall-observation-error"); return; }
    if (bytes < (long) offsetof(struct np_syscall_info, data)) { fail("syscall-observation-short"); return; }
    if (task->call.arch != NP_AUDIT_ARCH) { fail("syscall-observation-architecture"); return; }
    if ((task->call.op == PTRACE_SYSCALL_INFO_ENTRY &&
         bytes < (long) (offsetof(struct np_syscall_info, data.entry.args) + sizeof(task->call.data.entry.args))) ||
        (task->call.op == PTRACE_SYSCALL_INFO_EXIT &&
         bytes < (long) (offsetof(struct np_syscall_info, data.exit.is_error) + sizeof(task->call.data.exit.is_error)))) {
      fail("syscall-observation-short"); return;
    }
    if (task->call.op == PTRACE_SYSCALL_INFO_ENTRY && task->signal_in_flight) {
      if (pending_exit_effect(task)) { fail("syscall-exit-unverifiable"); return; }
      task->signal_in_flight = 0;
      if (exclusive_pid == pid) exclusive_pid = 0;
    }
    if (task->call.op == PTRACE_SYSCALL_INFO_ENTRY) {
      if (task->write_interrupt_requested) { fail("syscall-exit-unverifiable"); return; }
      task->control_checked = 0;
      if (root_reaped) { fail("orphan-descendant"); return; }
      if (++syscall_count > NP_MAX_SYSCALLS) { fail("syscall-limit"); return; }
      task->inspect = needs_inspection(task->call.data.entry.nr);
    } else if (task->call.op == PTRACE_SYSCALL_INFO_EXIT) {
      task->pending_next_exec = 0;
      if (task->synthetic_next_env && !finish_next_env_metadata(task)) return;
      if (task->pending_sysv_create) {
        if (task->call.data.exit.rval >= 0) {
          struct np_sysv_row row;
          int id = (int) task->call.data.exit.rval;
          if (task->call.data.exit.rval > INT_MAX || sysv_created >= 4 || sysv_index((uint64_t) id) >= 0 ||
              sysv_snapshot(id, &row) != 1 || row.key != task->pending_sysv_key || row.size != 56 ||
              row.uid != NP_CHILD_UID || row.cuid != NP_CHILD_UID || (row.mode & 0777) != 0600 ||
              row.creator <= 0 || row.creator > INT_MAX || !find_task((pid_t) row.creator) || !registered_postgres((pid_t) row.creator)) {
            fail("sysv-ipc-identity"); return;
          }
          sysv_segments[sysv_created++] = (struct np_sysv_segment) { id, task->pending_sysv_key, row.creator, 0 };
        }
        task->pending_sysv_create = 0;
      }
      if (task->pending_sysv_attach) {
        unsigned index = task->pending_sysv_attach - 1;
        if (task->call.data.exit.rval >= 0) {
          uint64_t address = (uint64_t) task->call.data.exit.rval;
          if (sysv_address_count >= 128 || !sysv_mapping(pid, address, index)) { fail("sysv-ipc-mapping"); return; }
          sysv_addresses[sysv_address_count++] = (struct np_sysv_address) { address, index };
        }
        task->pending_sysv_attach = 0;
      }
      if (task->pending_sysv_rmid) {
        if (task->call.data.exit.rval == 0) { sysv_segments[task->pending_sysv_rmid - 1].removed = 1; sysv_rmid_calls++; }
        task->pending_sysv_rmid = 0;
      }
      if (task->pending_socket) {
        if (task->call.data.exit.rval >= 0) {
          struct np_netlink_socket *record = socket_record(pid, (uint64_t) task->call.data.exit.rval, 1);
          if (!record) return;
          /* New kernel socket identity must never inherit an old inode's bind
           * authority if the kernel recycles that inode during this run. */
          record->bound = 0;
          record->protocol = task->pending_netlink ? task->pending_netlink - 1 : UINT_MAX;
        }
        task->pending_socket = task->pending_netlink = 0;
      }
      if (task->pending_socketpair) {
        if (task->call.data.exit.rval == 0) {
          int descriptors[2];
          size_t i;
          if (!memory(pid, task->pending_socketpair, descriptors, sizeof(descriptors))) { fail("socket-identity-unverifiable"); return; }
          for (i = 0; i < 2; i++) {
            struct np_netlink_socket *record = socket_record(pid, (uint64_t) descriptors[i], 1);
            if (!record) return;
            record->bound = 0;
            record->protocol = UINT_MAX;
          }
        }
        task->pending_socketpair = 0;
      }
      if (task->pending_bind) {
        if (task->call.data.exit.rval == 0) {
          struct np_netlink_socket *record = socket_record(pid, task->pending_bind - 1, 1);
          if (!record) return;
          record->bound = 1;
        }
        task->pending_bind = 0;
      }
      if (task->clear_refs_write) {
        if (task->call.data.exit.rval > 1) { fail("bookkeeping-write-unverifiable"); return; }
        if (task->call.data.exit.rval == 1) clear_refs_writes++;
        task->clear_refs_write = 0;
      }
      if (task->bookkeeping_open_target) {
        int value;
        if (!bookkeeping_value(task->bookkeeping_open_target, &value) || value != task->bookkeeping_open_value) {
          fail("bookkeeping-open-effect"); return;
        }
        task->bookkeeping_open_target = 0;
      }
      if (task->bookkeeping_write_length) {
        if (task->call.data.exit.rval > 0 && task->call.data.exit.rval != task->bookkeeping_write_length) {
          fail("bookkeeping-write-unverifiable"); return;
        }
        if (task->call.data.exit.rval == task->bookkeeping_write_length) bookkeeping_writes++;
        task->bookkeeping_write_length = 0;
      }
      if (task->failure_only_probe) {
        int probe = task->failure_only_probe;
        task->failure_only_probe = 0;
        if (task->call.data.exit.rval >= 0) { fail("runtime-probe-succeeded"); return; }
        if (probe == 2) blocked_ipv6_datagrams++;
        if (probe == 3) blocked_ipv4_datagrams++;
        if (probe == 4) blocked_nscd_probes++;
        if (probe == 5) blocked_empty_metadata++;
        blocked_runtime_probes++;
      }
      if (task->write_interrupt_requested) {
        task->write_yield_until_ms = now_ms() + 100;
        task->write_interrupt_requested = 0;
        blocking_write_yields++;
      }
      task->write_resumed_ms = 0;
      task->signal_in_flight = 0;
      task->inspect = 0;
      if (exclusive_pid == pid) exclusive_pid = 0;
    } else fail("unexpected-syscall-stop");
    return;
  }
  if (stop_signal == SIGTRAP || stop_signal == SIGSTOP) { fail("unexpected-stop-signal"); return; }
  task->signal = stop_signal;
}

static void kill_and_reap(void) {
  uint64_t deadline = now_ms() + 5000;
  size_t i;
  int status;
  pid_t pid;
  for (i = 0; i < used_tasks; i++)
    if (tasks[i].alive) kill(tasks[i].pid, SIGKILL);
  while (now_ms() < deadline) {
    pid = waitpid(-1, &status, __WALL | WNOHANG);
    if (pid > 0) {
      struct np_task *task = find_task(pid);
      if (WIFEXITED(status) || WIFSIGNALED(status)) {
        if (task) { task->alive = 0; task->terminal_status = status; task->terminal_waits = 1; live_tasks--; reaped_tasks++; }
        terminal_waits++;
        if (pid == root_pid) {
          root_reaped = 1;
          if (WIFEXITED(status)) root_exit = WEXITSTATUS(status);
          if (WIFSIGNALED(status)) root_signal = WTERMSIG(status);
        }
      } else if (WIFSTOPPED(status)) {
        kill(pid, SIGKILL);
        ptrace(PTRACE_CONT, pid, NULL, (void *) (intptr_t) SIGKILL);
      }
    } else if (pid == -1 && errno == ECHILD) { kernel_children_empty = 1; break; }
    else { struct timespec pause = { 0, 1000000 }; nanosleep(&pause, NULL); }
  }
}

static int port_number(const char *text, unsigned *out) {
  char *end;
  unsigned long value;
  if (!*text || *text == '+' || *text == '-') return 0;
  errno = 0;
  value = strtoul(text, &end, 10);
  if (errno || *end || value < 1024 || value > 65535) return 0;
  *out = (unsigned) value;
  return 1;
}

static int directory_argument(const char *raw, char out[NP_MAX_PATH]) {
  struct stat st;
  if (raw[0] != '/' || !realpath(raw, out) || !strcmp(out, "/") || stat(out, &st) || !S_ISDIR(st.st_mode)) return 0;
  return 1;
}

static int file_argument(const char *raw, char out[NP_MAX_PATH], int executable) {
  struct stat st;
  if (raw[0] != '/' || !realpath(raw, out) || stat(out, &st) || !S_ISREG(st.st_mode)) return 0;
  return !executable || access(out, X_OK) == 0;
}

static int audit_argument(const char *raw) {
  char copy[NP_MAX_PATH], parent[NP_MAX_PATH], *name;
  struct stat st;
  if (raw[0] != '/' || strlen(raw) >= sizeof(copy)) return 0;
  strcpy(copy, raw);
  name = strrchr(copy, '/');
  if (!name || !name[1] || strchr(name + 1, '\\') || !strcmp(name + 1, ".") || !strcmp(name + 1, "..")) return 0;
  *name++ = 0;
  if (!realpath(copy[0] ? copy : "/", parent) || stat(parent, &st) || !S_ISDIR(st.st_mode) ||
      st.st_uid != 0 || (st.st_mode & 0077) || beneath(parent, output_root) || beneath(parent, project_root)) return 0;
  if (snprintf(audit_file, sizeof(audit_file), "%s/%s", parent, name) >= (int) sizeof(audit_file)) return 0;
  return lstat(audit_file, &st) == -1 && errno == ENOENT;
}

static int child_limits(void) {
  const struct rlimit core = { 0, 0 }, cpu = { 100, 100 },
    files = { 1024, 1024 }, file_size = { 268435456, 268435456 }, nice_limit = { 0, 0 };
  return !setrlimit(RLIMIT_CORE, &core) && !setrlimit(RLIMIT_CPU, &cpu) &&
    !setrlimit(RLIMIT_NOFILE, &files) && !setrlimit(RLIMIT_FSIZE, &file_size) && !setrlimit(RLIMIT_NICE, &nice_limit);
}

static int supervisor_capabilities(void) {
  struct __user_cap_header_struct header = { _LINUX_CAPABILITY_VERSION_3, 0 };
  struct __user_cap_data_struct data[2];
  uint32_t required = (1U << CAP_SYS_PTRACE) | (1U << CAP_SETUID) |
    (1U << CAP_SETGID) | (1U << CAP_KILL);
  memset(data, 0, sizeof(data));
  if (syscall(SYS_capget, &header, &data)) return 0;
  return data[0].effective == required && data[0].permitted == required &&
    !data[0].inheritable && !data[1].effective && !data[1].permitted && !data[1].inheritable;
}

static int child_feature_profile(void) {
  /* No Internet UDP endpoint can exist. Chromium can discover that optional
   * DNS/reachability probes are unavailable before any external bind/connect.
   * HTTP/PostgreSQL TCP retain exact IPv4/IPv6 loopback admission. This filter
   * is inherited by every descendant and cannot be removed after no_new_privs. */
  struct sock_filter filters[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NP_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, 0, 6),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET, 1, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_INET6, 0, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, 0xf),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SOCK_DGRAM, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EAFNOSUPPORT)
  };
  struct sock_fprog program = { (unsigned short) (sizeof(filters) / sizeof(filters[0])), filters };
  return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) == 0;
}

static void child_start(int handshake, int ready) {
  struct __user_cap_header_struct header = { _LINUX_CAPABILITY_VERSION_3, 0 };
  struct __user_cap_data_struct data[2];
  char home[NP_MAX_PATH], temporary[NP_MAX_PATH], byte;
  int null_fd;
  char *child_argv[] = { node_executable, driver_file, NULL };
  memset(data, 0, sizeof(data));
  if (setgroups(0, NULL) || setresgid(NP_CHILD_GID, NP_CHILD_GID, NP_CHILD_GID) ||
      setresuid(NP_CHILD_UID, NP_CHILD_UID, NP_CHILD_UID) || syscall(SYS_capset, &header, &data) ||
      prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || !child_limits() || !child_feature_profile()) _exit(126);
  if (snprintf(home, sizeof(home), "%s/home", output_root) >= (int) sizeof(home) ||
      snprintf(temporary, sizeof(temporary), "%s/tmp", output_root) >= (int) sizeof(temporary)) _exit(126);
  if (clearenv() || setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1) || setenv("NODE_ENV", "test", 1) ||
      setenv("TZ", "UTC", 1) || setenv("CI", "1", 1) || setenv("HOME", home, 1) ||
      setenv("TMPDIR", temporary, 1) || setenv("UV_USE_IO_URING", "0", 1) || chdir(project_root)) _exit(126);
  null_fd = open("/dev/null", O_RDWR | O_CLOEXEC);
  if (null_fd < 0 || dup2(null_fd, 0) < 0 || dup2(null_fd, 1) < 0 || dup2(null_fd, 2) < 0) _exit(126);
  if (null_fd > 2) close(null_fd);
  /* Mark every ambient inherited fd close-on-exec, including the bootstrap
   * pipes. Only this fixed C bootstrap runs before they are closed by exec. */
#ifdef SYS_close_range
  if (syscall(SYS_close_range, 3U, ~0U, 4U)) _exit(126);
#else
  _exit(126);
#endif
  if (write(ready, "B", 1) != 1) _exit(126);
  close(ready);
  /* The only inherited non-standard fd is this private bootstrap pipe. */
  if (read(handshake, &byte, 1) != 1 || byte != 'R') _exit(126);
  close(handshake);
  execve(node_executable, child_argv, environ);
  _exit(127);
}

static int report(const char *status) {
  char json[2048], code[32];
  int fd = -1, length;
  if (root_exit < 0) strcpy(code, "null"); else snprintf(code, sizeof(code), "%d", root_exit);
  length = snprintf(json, sizeof(json),
    "{\"schemaVersion\":\"np.site-build-linux-audit.v1\",\"status\":\"%s\",\"reason\":\"%s\","
    "\"platform\":\"" NP_PLATFORM "\",\"rootExitCode\":%s,\"rootSignal\":%d,"
    "\"tracedProcesses\":%zu,\"reapedProcesses\":%zu,\"peakTracees\":%zu,\"terminalWaits\":%zu,"
    "\"syscallsObserved\":%llu,\"blockingWriteInterrupts\":%llu,\"blockingWriteYields\":%llu,\"creationOperations\":%llu,\"chargedOutputBytes\":%llu,\"blockedRuntimeProbes\":%llu,"
    "\"blockedIpv6Datagrams\":%llu,\"blockedIpv4Datagrams\":%llu,\"blockedNscdProbes\":%llu,\"blockedEmptyMetadata\":%llu,\"blockedNextEnvMetadata\":%llu,"
    "\"bookkeepingOpens\":%llu,\"bookkeepingAttempts\":%llu,\"bookkeepingWrites\":%llu,"
    "\"clearRefsOpens\":%llu,\"clearRefsAttempts\":%llu,\"clearRefsWrites\":%llu,"
    "\"sysvShmCreateAttempts\":%zu,\"sysvShmCreated\":%zu,\"sysvShmChargedBytes\":%zu,\"sysvShmRmidCalls\":%zu,\"ownIpcReclaimed\":%s,"
    "\"forbiddenAttempts\":%d,\"blockedSyscall\":%d,"
    "\"blockedWriteActor\":\"%s\",\"blockedWriteTarget\":\"%s\",\"blockedWriteTargetState\":\"%s\","
    "\"descendantsReaped\":%s,\"argumentsFrozen\":true}\n",
    status, reason, code, root_signal, used_tasks, reaped_tasks, peak_tasks, terminal_waits,
    (unsigned long long) syscall_count, (unsigned long long) blocking_write_interrupts, (unsigned long long) blocking_write_yields, (unsigned long long) creation_operations,
    (unsigned long long) charged_output_bytes, (unsigned long long) blocked_runtime_probes,
    (unsigned long long) blocked_ipv6_datagrams, (unsigned long long) blocked_ipv4_datagrams, (unsigned long long) blocked_nscd_probes, (unsigned long long) blocked_empty_metadata, (unsigned long long) blocked_next_env_metadata,
    (unsigned long long) bookkeeping_opens, (unsigned long long) bookkeeping_attempts, (unsigned long long) bookkeeping_writes,
    (unsigned long long) clear_refs_opens, (unsigned long long) clear_refs_attempts, (unsigned long long) clear_refs_writes,
    sysv_create_attempts, sysv_created, sysv_create_attempts * 56, sysv_rmid_calls, sysv_reclaimed ? "true" : "false",
    violation ? 1 : 0, blocked_syscall, blocked_write_actor, blocked_write_target, blocked_write_target_state,
    live_tasks || !kernel_children_empty ? "false" : "true");
  if (length <= 0 || length >= (int) sizeof(json)) return 70;
  setfsuid(0);
  if (setfsuid((uid_t) -1) != 0) return 70;
  if (audit_file[0]) {
    fd = open(audit_file, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0 || write(fd, json, (size_t) length) != length || fsync(fd) || close(fd)) return 70;
  }
  if (write(STDOUT_FILENO, json, (size_t) length) != length) return 70;
  return !strcmp(status, "passed") ? 0 : violation ? 71 : 70;
}

int main(int argc, char **argv) {
  int handshake[2], ready[2], status;
  pid_t child, observed;
  struct np_task *root;
  struct sigaction action;
  struct itimerval timer = { { 0, 100000 }, { 0, 100000 } };
  supervisor_pid = getpid();
  started_ms = now_ms();
  if (argc != 8 || getuid() != 0 || geteuid() != 0 || !supervisor_capabilities() ||
      !directory_argument(argv[1], project_root) || !directory_argument(argv[2], output_root) ||
      beneath(project_root, output_root) || beneath(output_root, project_root) ||
      !file_argument(argv[3], node_executable, 1) || !file_argument(argv[4], driver_file, 0) ||
      !port_number(argv[5], &http_port) || !port_number(argv[6], &postgres_port) || http_port == postgres_port ||
      !audit_argument(argv[7])) { fail("invalid-supervisor-input"); return report("unavailable"); }
  if (prctl(PR_SET_DUMPABLE, 0) || prctl(PR_SET_CHILD_SUBREAPER, 1) ||
      pipe2(handshake, O_CLOEXEC) || pipe2(ready, O_CLOEXEC)) {
    fail("supervisor-initialization"); return report("unavailable");
  }
  child = fork();
  if (child < 0) { fail("supervisor-fork"); return report("unavailable"); }
  if (!child) { close(handshake[1]); close(ready[0]); child_start(handshake[0], ready[1]); }
  root_pid = child;
  close(handshake[0]);
  close(ready[1]);
  root = add_task(child);
  if (root) root->creation_seen = 1;
  {
    char byte;
    struct pollfd descriptor = { ready[0], POLLIN, 0 };
    if (poll(&descriptor, 1, 5000) != 1 || read(ready[0], &byte, 1) != 1 || byte != 'B')
      fail("child-bootstrap");
    close(ready[0]);
  }
  if (failed || !root || ptrace(PTRACE_SEIZE, child, NULL, (void *) (uintptr_t) NP_OPTIONS) == -1 ||
      ptrace(PTRACE_INTERRUPT, child, NULL, NULL) == -1 ||
      waitpid(child, &status, __WALL) != child || !WIFSTOPPED(status)) {
    fail("ptrace-unavailable"); close(handshake[1]); kill_and_reap(); return report("unavailable");
  }
  root->stopped = 1;
  /* PTRACE authorizes memory observation, not the DAC traversal of a dropped
   * child's /proc/<pid>/fd. Observe file paths as that child rather than adding
   * a broad filesystem-override capability. Only report() restores root fsuid. */
  setfsuid(NP_CHILD_UID);
  if (setfsuid((uid_t) -1) != NP_CHILD_UID) fail("supervisor-filesystem-identity");
  /* Bind filesystem identities as the same dropped fsuid used for every later
   * check. Virtiofs can present ownership relative to this caller identity. The
   * child is still in its private bootstrap stop and has run no project code. */
  next_environment_ready = next_environment_snapshot(1);
  if (write(handshake[1], "R", 1) != 1) fail("supervisor-handshake");
  close(handshake[1]);
  memset(&action, 0, sizeof(action));
  action.sa_handler = tick;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGALRM, &action, NULL) || setitimer(ITIMER_REAL, &timer, NULL)) fail("supervisor-timer");
  schedule();
  while (live_tasks && !failed) {
    if (now_ms() - started_ms >= NP_DEADLINE_MS) { fail("deadline"); break; }
    if (root_reaped && now_ms() - root_finished_ms > 250) { fail("orphan-descendant"); break; }
    observed = waitpid(-1, &status, __WALL);
    if (observed > 0) observe(observed, status);
    else if (observed == -1 && errno != EINTR) { fail("trace-wait"); break; }
    schedule();
  }
  if (!failed) {
    uint64_t drain_deadline = now_ms() + 250;
    for (;;) {
      observed = waitpid(-1, &status, __WALL | WNOHANG);
      if (observed > 0) { observe(observed, status); if (failed) break; }
      else if (observed == -1 && errno == ECHILD) { kernel_children_empty = 1; break; }
      else if (observed == -1 && errno != EINTR) { fail("trace-wait"); break; }
      else if (now_ms() >= drain_deadline) { fail("descendant-cleanup"); break; }
      else { struct timespec pause = { 0, 1000000 }; nanosleep(&pause, NULL); }
    }
  }
  if (failed) kill_and_reap();
  if (!root_reaped || live_tasks || !kernel_children_empty || reaped_tasks != used_tasks) {
    fail("descendant-cleanup"); return report("failed");
  }
  sysv_cleanup_verified();
  if (failed) return report(violation ? "violation" : "failed");
  return report("passed");
}
`;
