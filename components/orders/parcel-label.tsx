import { formatDateTimeYangon, formatMmk, formatMyanmarPhone } from '@/lib/utils'
import { formatWeight, labelAreaName, labelMoney } from '@/lib/orders/label'
import type { OrderLabelRow } from '@/lib/orders/queries'

/**
 * One 100x150mm thermal waybill.
 *
 * DESIGNED FOR A MONOCHROME PRINTER. The rolls these shops own print black on
 * white and nothing else, so no distinction on this label may be carried by
 * colour alone: the COLLECT box is a heavy black rule, not a filled swatch, and
 * the route prints its NAME beside the colour dot. `print-color-adjust` is set
 * so the dot survives on a colour printer, but nothing depends on it arriving.
 *
 * SIZED IN MILLIMETRES, not rem. The page box is a physical 100x150mm and the
 * label has to fill it exactly on paper while still being legible on screen, so
 * every dimension here is physical too. Type is in pt for the same reason.
 *
 * Read by a rider and a customer, never by whoever pressed print -- hence the
 * fixed English scaffolding with the Burmese area name alongside, rather than
 * anything that follows the shop's language toggle. See labelAreaName().
 */
export function ParcelLabel({ order }: { order: OrderLabelRow }) {
  const money = labelMoney(order)
  const area = labelAreaName(order.service_areas)
  const weight = formatWeight(order.parcel_weight_g)
  const shop = order.shops

  return (
    <article
      className="mge-label flex flex-col overflow-hidden bg-white text-black"
      style={{
        width: '100mm',
        height: '150mm',
        padding: '4mm',
        // Thermal heads lose the outermost millimetre or two; nothing important
        // is allowed near the edge.
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    >
      {/* ---- masthead ---------------------------------------------------- */}
      <header className="flex items-baseline justify-between border-b-2 border-black pb-[1.5mm]">
        <span className="font-bold tracking-tight" style={{ fontSize: '10pt' }}>
          MINGALAR EXPRESS
        </span>
        {order.routes ? (
          <span className="flex items-center gap-[1.5mm]" style={{ fontSize: '8pt' }}>
            <span
              className="inline-block rounded-full"
              style={{
                width: '2.5mm',
                height: '2.5mm',
                backgroundColor: order.routes.colour,
                border: '0.3mm solid black',
              }}
              aria-hidden="true"
            />
            {order.routes.name}
          </span>
        ) : null}
      </header>

      {/* ---- the code, the biggest thing on the label -------------------- */}
      <div className="border-b border-black py-[2mm]">
        <p
          className="font-mono font-bold leading-none tracking-tight"
          style={{ fontSize: '20pt' }}
        >
          {order.code}
        </p>
        <p className="text-neutral-700" style={{ fontSize: '7pt', marginTop: '1mm' }}>
          {formatDateTimeYangon(order.created_at)}
        </p>
      </div>

      {/* ---- recipient --------------------------------------------------- */}
      <section className="flex-1 py-[2mm]" style={{ minHeight: 0 }}>
        <p className="font-bold tracking-widest text-neutral-600" style={{ fontSize: '7pt' }}>
          TO / ပို့ရန်
        </p>
        <p className="font-bold leading-tight" style={{ fontSize: '13pt' }}>
          {order.customer_name}
        </p>
        {/* The rider dials this from a bike mount. It is the second-largest
            thing here on purpose. */}
        <p className="font-mono font-semibold leading-tight" style={{ fontSize: '12pt' }}>
          {formatMyanmarPhone(order.customer_phone)}
          {order.customer_phone_alt ? (
            <span className="font-normal text-neutral-700" style={{ fontSize: '9pt' }}>
              {'  '}
              {formatMyanmarPhone(order.customer_phone_alt)}
            </span>
          ) : null}
        </p>
        <p className="leading-snug" style={{ fontSize: '9.5pt', marginTop: '1mm' }}>
          {order.dropoff_address}
        </p>
        {area ? (
          <p className="font-semibold leading-snug" style={{ fontSize: '10pt' }} lang="my">
            {area}
          </p>
        ) : null}
        {order.dropoff_note ? (
          <p className="italic leading-snug text-neutral-800" style={{ fontSize: '8.5pt' }}>
            {order.dropoff_note}
          </p>
        ) : null}
      </section>

      {/* ---- money ------------------------------------------------------- */}
      {money.collect ? (
        <section
          className="flex items-baseline justify-between border-y-[0.8mm] border-black px-[2mm] py-[1.5mm]"
        >
          <span className="font-bold tracking-widest" style={{ fontSize: '9pt' }}>
            COLLECT
          </span>
          <span className="font-mono font-bold leading-none" style={{ fontSize: '17pt' }}>
            {/* labelMoney, not cod_amount + delivery_fee. See lib/orders/label.ts. */}
            {money.text}
          </span>
        </section>
      ) : (
        <section className="border-y-[0.8mm] border-black px-[2mm] py-[1.5mm] text-center">
          <span className="font-bold tracking-widest" style={{ fontSize: '11pt' }}>
            PREPAID — COLLECT NOTHING
          </span>
        </section>
      )}
      <p className="text-neutral-700" style={{ fontSize: '7pt', marginTop: '1mm' }}>
        {money.collect
          ? money.feeNote === 'included'
            ? `Cash on delivery · includes the ${formatMmk(order.delivery_fee)} delivery fee`
            : `Cash on delivery · delivery fee paid by the shop`
          : 'ငွေရှင်းပြီး — ရိုက်ဒါ ငွေမကောက်ပါ'}
      </p>

      {/* ---- sender + parcel --------------------------------------------- */}
      <footer className="border-t border-black pt-[1.5mm]" style={{ fontSize: '8pt' }}>
        <p className="truncate">
          <span className="font-bold tracking-widest text-neutral-600">FROM </span>
          {shop ? (
            <>
              <span className="font-semibold">{shop.name}</span>
              {' · '}
              <span className="font-mono">{formatMyanmarPhone(shop.phone)}</span>
            </>
          ) : (
            <span className="font-semibold">Mingalar Express</span>
          )}
        </p>
        <p className="truncate text-neutral-700" style={{ fontSize: '7pt' }}>
          {order.pickup_address}
        </p>
        <p className="truncate" style={{ fontSize: '7.5pt', marginTop: '0.5mm' }}>
          {order.parcel_desc}
          {weight ? ` · ${weight}` : ''}
          {order.is_fragile ? (
            <span className="ml-[1.5mm] border border-black px-[1mm] font-bold">FRAGILE</span>
          ) : null}
        </p>
      </footer>
    </article>
  )
}
