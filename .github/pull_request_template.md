## Summary
<!-- What does this PR do and why? -->

**Task ID:** <!-- e.g. I3-LAB-02 -->
**Requirements:** <!-- FR / BR / AC / EC IDs -->
**Branch flow:** `dev-lab` | `dev-customer` | `feature/...` → `main`

## Shared change?
- [ ] No
- [ ] Yes. Touches database / api-contract / shared / state machine / payments / identity. **Impact on the other module:**
<!-- describe -->

## Checklist (Definition of Done)
- [ ] Implementation matches the referenced docs and `openapi.yaml`
- [ ] Unit + integration tests added and passing
- [ ] Permission-matrix and tenant-isolation tests updated (new endpoints)
- [ ] Maker/Checker enforced server-side (if applicable)
- [ ] Money in paise, no floats. Times in UTC.
- [ ] No out-of-scope features (`docs/01-product/SCOPE_AND_EXCLUSIONS.md`)
- [ ] No invented ICICI API details
- [ ] Migration included and tested (if schema changed). Forward-compatible.
- [ ] Docs updated (incl. RTM). ADR added if it's a significant decision.
- [ ] No secrets or personal data in code, logs or fixtures

## Screenshots / API examples
<!-- optional -->
