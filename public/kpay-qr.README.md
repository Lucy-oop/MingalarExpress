# public/kpay-qr.png

The office's KBZPay QR, shown to a customer paying by transfer.
`app_settings.kpay_qr_url` points at `/kpay-qr.png`.

## It is cropped, and that turned out to matter

The image supplied was the full KBZPay share poster: 1081x1600, with the Burmese
heading, the account line and the KBZPay logo around a 647x643 QR card. Cropped
to the card and saved as lossless PNG.

Not cosmetic. Checked with OpenCV's QR decoder:

    the crop, fitted to 260px      decodes, payload identical to the original
    the whole poster, same box     FAILS to decode

Because the poster is portrait, fitting it into the panel leaves the QR itself
about a third of the width — below what a camera can resolve off a phone screen.
Every size from 200 to 300px decodes from the crop, so the rendered 260px has
margin either side.

## If you replace it

Crop to the white card, keep its quiet zone (the white border is part of the
code), and save as PNG rather than JPEG — a QR is line art and JPEG ringing
around the module edges is exactly what makes a marginal scan fail.

Then check it, rather than eyeballing it:

    python3 -c "import cv2; print(cv2.QRCodeDetector().detectAndDecode(cv2.imread('public/kpay-qr.png'))[0][:24])"

A static asset rather than a Storage object for one reason: a rider in a
stairwell with no signal still has to be able to show it, and the service worker
caches this path. A signed Storage URL would fail exactly when it is needed.

The account name and phone live in `app_settings.kpay_account_name` and
`kpay_phone`, so those change with an UPDATE and no deploy at all.
