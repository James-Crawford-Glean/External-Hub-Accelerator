// The pglite contrib subpath export isn't resolvable under moduleResolution:node
// (types live at dist/contrib/pg_trgm.d.ts). Test-only; runtime resolves fine.
declare module '@electric-sql/pglite/contrib/pg_trgm' {
   
  export const pg_trgm: any;
}
