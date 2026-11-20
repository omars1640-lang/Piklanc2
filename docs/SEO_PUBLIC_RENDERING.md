# Public SEO rendering

The editable HTML files remain at the repository root. `scripts/prepare-public-pages.cjs`
copies the 18 public templates into the Functions deployment bundle before deployment
and before `npm test`. Never edit generated `functions/public-pages/` files.

Firebase Hosting serves exact static files before rewrites. These 18 template files
are therefore excluded from the Hosting upload and their exact public routes are
rewritten to `publicPage`. Authentication, dashboards, maintenance, registration,
early-access codes, wallet operations, Firestore rules and Storage rules remain on
their existing routes and implementations. Unknown paths still use the existing 404.

## Behavior

- Public articles/services render their actual published content into the same HTML
  elements used by the current browser scripts. No alternate bot-only page exists.
- Only published records and selected public fields are rendered. Draft revisions,
  private user records and contact details are not serialized into a bootstrap object.
- Settings are checked on every request. HTML is not shared/CDN cached, so a prior
  open/published response is not reused after closing the platform or unpublishing.
- Closed modes return an unfilled, noindex, pending-access template with HTTP 503 and
  Retry-After. The existing auth guard still allows admins and early-access accounts
  according to the unchanged access policy. Browser read errors cannot fail open
  over a known server-side closed mode.
- Database failures return a visible retryable 503, never a false 404. Missing and
  unpublished articles/services return a real 404 with noindex.
- All document reads on one page share an eight-second deadline; an unresponsive
  backend cannot leave the HTTP request waiting indefinitely.
- Public www routes and index.html permanently redirect to https://piklance.com,
  retaining IDs and query parameters. Authentication/private routes are deliberately
  not redirected. Canonicals omit tracking parameters but retain the content ID.
- Descriptions, Open Graph and article structured data are escaped. Supported article
  body formatting remains the same headings/paragraphs/bullets as the client renderer.

## Checks

Run `npm test` in `functions`, all scripts from the Repository safety workflow, and
`node scripts/prepare-public-pages.cjs`. For a local browser preview run
`node scripts/preview-public-pages.cjs`. The preview uses anonymous read-only
Firestore REST requests, not Admin credentials; it supports no database writes.
It is for reading the existing public content, not for submitting orders or forms.

## Deployment and rollback

Deploy Functions + Hosting together for the first release. `pinTag: true` pins the
publicPage revision to the Hosting release so subsequent Hosting rollback restores
the matching renderer. Preparation hooks keep the templates in sync with the UI.
Do not manually publish Hosting with these templates omitted unless publicPage is
deployed/pinned in that release. A complete revert of this commit restores static
Hosting, without deleting data or migrating any schema.

After deployment, verify root, article, service, invalid IDs, www redirect and sign-in,
and run a Google live inspection including its rendered screenshot and HTML. Local
tests cannot establish Google's production rendering or guarantee indexing/ranking.
The public routes now use Cloud Functions for HTML; monitor latency/read costs and
errors. They do not query growing collections or financial/admin content on a page load.

No production deployment or indexing request is part of the implementation task.
