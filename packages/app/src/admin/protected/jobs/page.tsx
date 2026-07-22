import { JobsView } from "@nexpress/admin/client";
import { getSearchCollectionLabels } from "@nexpress/core/search";

import { ensureFor } from "../../../lib/init-core";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  await ensureFor("read");
  const searchCollections = Object.entries(getSearchCollectionLabels()).map(([slug, label]) => ({
    slug,
    label,
  }));
  return <JobsView searchCollections={searchCollections} />;
}
