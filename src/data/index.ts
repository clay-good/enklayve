/**
 * Data access layer: schemas, integrity verification, manifest loading, and
 * the per-dataset fail-safe gate. See BUILD-SPEC.md §7 and §8.
 */
export * from "./schemas";
export { sha256Hex, verifyHash } from "./integrity";
export {
  loadDataset,
  loadManifest,
  needsVerifyBanner,
  type DatasetStatus,
  type LoadedDataset,
  type LoadedManifest,
} from "./loader";
