import 'server-only'
import { createAdminClient } from './admin'

/**
 * The dashboard has no sign-in, so there is no user session to read the
 * database with. Queries therefore run server-side under the service role.
 *
 * This is deliberately NOT the same as opening the database up. The `anon`
 * role stays revoked (see 0003_revoke_anon.sql), so nothing is reachable from
 * a browser — data is fetched in Server Components and only rendered HTML
 * crosses the wire. The service key never reaches the client: this module is
 * marked `server-only`, which makes importing it from a Client Component a
 * build error rather than a leak.
 *
 * The page itself is public to anyone with the URL. Restrict that at the edge
 * with Vercel Deployment Protection, not by loosening RLS.
 */
export function createReadClient() {
  return createAdminClient()
}
