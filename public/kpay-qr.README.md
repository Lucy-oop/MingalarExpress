# public/kpay-qr.png

The office's KBZPay QR, shown to a customer paying by transfer.

**This file is missing on purpose.** Save the KBZPay QR image here as
`kpay-qr.png` — the one from the KBZPay app under "My QR", cropped to the code
itself. `app_settings.kpay_qr_url` points at `/kpay-qr.png` and can be repointed
without a deploy if you would rather host it elsewhere.

It is a static asset rather than a Storage object for one reason: a rider in a
stairwell with no signal still has to be able to show it, and the service worker
caches this path. A signed Storage URL would fail exactly when it is needed.

The account name and phone live in `app_settings.kpay_account_name` and
`kpay_phone`, so those two change with an UPDATE and no deploy at all.
