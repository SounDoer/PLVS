mod bootstrap;
pub mod commands;
mod hydration;
mod library;
mod migration;
mod session;
mod workspace;
mod workspace_catalog;

pub use bootstrap::{prepare_identity_storage, PreparedIdentityStorage};
pub use hydration::{hydrate_workspace, HydratedWorkspace};
#[cfg(debug_assertions)]
pub use library::run_library_test_host;
pub use library::{
  GlobalPreference, LibraryCollection, LibraryError, LibraryItem, LibraryRepository,
};
pub use migration::{
  migrate_legacy_store, plan_legacy_store, LegacyLibrarySeed, LegacyMigrationOutcome,
  LegacyMigrationPlan,
};
pub use session::{WorkspaceDomain, WorkspacePersistenceSession, WorkspaceValue};
#[cfg(debug_assertions)]
pub use workspace::run_lease_test_host;
pub use workspace::WorkspaceStore;
pub use workspace_catalog::WorkspaceCatalog;
