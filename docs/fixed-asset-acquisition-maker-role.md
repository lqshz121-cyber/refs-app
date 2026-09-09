# Fixed asset acquisition maker

The formal FIXED_ASSET_ACQUISITION_MAKER role is a HUMAN/DRAFT bundle containing
exactly FIXED_ASSET.ACQUISITION.DRAFT, FIXED_ASSET.REGISTER.VIEW, GL.JE.CREATE
and GL.JE.VIEW. The dedicated permission separates acquisition preparation from
other journal and fixed-asset Draft operations. This lets an acquisition maker
open the register and asset detail, read the acquisition form, create its Draft,
and read the resulting journal through the same authenticated database role.
Submit, review, approval, posting, imports and role administration are absent.

The catalog addition grants nothing to existing users. Production assignment must
use the established authorized grant workflow with its finite duration, subject
identity and audit checks. No production assignment was performed for this change.

The real PostgreSQL native acquisition test uses the exact bundle for HTTP list,
detail, options, uppercase-UUID create, lowercase replay and fresh journal read.
Independent workflow actors continue the later submit/review/approve/Post stages.
Owned test principals do not constitute live OIDC acceptance. The UI must also
gate its acquisition control against fresh current-company access; that integration
is maintained in the separate frontend scope.
