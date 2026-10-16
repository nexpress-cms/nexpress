import type { NpAgentConnectionDestinationDescriptorV1 } from "../agent-contract/types.js";

export interface NpAgentNotificationConnectionSnapshotV1 {
  siteId: string;
  connectionId: string;
  configSnapshotId: string;
  adapterId: string;
  adapterContractVersion: number;
  adapterFingerprint: string;
  configVersion: number;
  configHash: string;
  accountSubjectKeyId: string;
  accountSubjectDigest: string;
  destinationKeyId: string;
  destinationDescriptor: NpAgentConnectionDestinationDescriptorV1;
  destinationFingerprint: string;
}
