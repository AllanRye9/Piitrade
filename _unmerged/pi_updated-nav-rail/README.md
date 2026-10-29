# Alternative category-menu design (from pi_updated.zip), not active

`pi_updated` and `eni-round12` redesigned the same category-bar dropdowns independently:

| | Active in this build (eni-round12, "Round 12") | Kept here (pi_updated) |
|---|---|---|
| "All" menu | grid of category cards, each with its top subcategories and "+N more" | a category **rail** on the left; hovering one shows ALL its live subcategories (most populated first) on the right |
| Structure | everything inside `CategoryBar.tsx` | dropdown UI split out into `NavMenus.tsx` (All / per-category / More panels share one shell) |
| Extras | header dropdowns (Browse, Sell, Help, account) restyled to match | caps a very long subcategory list and links on to the category page; tests updated to match |

Both cannot be active at once (they replace the same code). To switch to the rail design:

1. Copy `CategoryBar.tsx` and `NavMenus.tsx` into `frontend/components/layout/` (replacing `CategoryBar.tsx`).
2. Copy `CategoryBar.test.tsx` into `frontend/navtest/`.
3. Re-apply the Round 12 restyle of `Header.tsx` if you still want matching header dropdowns (it is already in the active build).

The `CountBadge` no-wrap fix that came with this design is already merged into the active build.
This folder is outside `frontend/`, so it is never compiled or shipped.
