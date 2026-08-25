/**
 * The login page renders on its own — no sidebar, no sync button, no data-age
 * banner. Those all read the database and belong to a signed-in session.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
