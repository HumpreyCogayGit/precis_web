# Authentication and Admin-Feature Readiness Criteria

Precis Web is intentionally unauthenticated while it remains read-only. Do not add admin, moderation, write, import, or configuration-changing routes until the criteria below are implemented and tested.

## Required controls before admin/write features

1. **Authentication**
   - Use a server-side authentication provider or session implementation.
   - Do not rely on frontend-only route hiding.
   - Store sessions in `HttpOnly`, `Secure`, `SameSite=Lax` or stricter cookies.

2. **Authorization**
   - Check authorization in every server route.
   - Require an explicit admin/moderator role for moderation and write operations.
   - Deny by default when the role or session is missing or malformed.

3. **CSRF protection**
   - Require CSRF tokens or equivalent same-site protections for every state-changing method (`POST`, `PUT`, `PATCH`, `DELETE`).
   - Verify CSRF failures return `403` and do not change state.

4. **Audit logging**
   - Log admin identity, action, target resource, request ID, timestamp, and result for every admin state change.
   - Redact secrets and sensitive payload fields from logs.

5. **Database separation**
   - Keep the public web runtime on the read-only view role.
   - Use a separate, least-privilege admin role for authenticated write features.
   - Do not grant the public runtime broad table privileges.

6. **Testing and CI**
   - Add tests proving unauthenticated users cannot access admin endpoints.
   - Add tests proving authenticated non-admin users cannot access admin endpoints.
   - Add tests proving CSRF attempts fail for state-changing actions.
   - Keep these checks in `.github/workflows/security-ci.yml` before deployment.

## Minimum route policy

Any future admin route must follow this policy:

```text
request -> authenticate session -> authorize required role -> verify CSRF for state changes -> execute least-privilege DB operation -> emit audit log
```

If any step fails, the route must stop before touching the database.