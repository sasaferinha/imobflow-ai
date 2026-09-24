# Number ending 3868 — app activation handoff

User explicitly authorized disconnecting the ImobFlow number to activate WhatsApp Business on the phone, then reconnect later.

Verified phone ID 1286346664565879 belongs to company ff57b659-e6d9-4ce1-a5c3-9e65804cef43, displayed number ends 3868, platform CLOUD_API, is_on_biz_app false. Outbox had 46 sent rows and no pending work at preflight.

Paused only this company's persisted connection (whatsapp_enabled=false). Preserved stored token, phone ID, account and conversation records. Meta POST /v26.0/1286346664565879/deregister returned HTTP 200 and success=true. Read-back confirms integration remains paused. No number/account deletion, credential change or message send performed.

Next: user completes phone app registration privately (SMS/call/PIN). Registration success is NOT yet verified. Do not re-register using ordinary Cloud API flow: that would defeat the intended app setup. Complete eligible Business App coexistence Embedded Signup after app activation, confirm is_on_biz_app and verify messages both directions and human takeover before enabling the integration. Coexistence approval/configuration and production signup configuration ID remain unverified/missing; reconnection is not guaranteed immediate.

Do not rerun the maintenance script blindly: it guards against already paused state and never retries the provider mutation automatically.
