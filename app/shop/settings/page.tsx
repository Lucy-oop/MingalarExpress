import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { MapCanvas } from '@/components/map'
import { formatMyanmarPhone } from '@/lib/utils'

export const metadata: Metadata = { title: 'Shop settings' }

export default async function ShopSettingsPage() {
  const { profile } = await requireShop()
  const supabase = await createClient()

  const { data: shop } = await supabase
    .from('shops')
    .select('id, name, phone, pickup_address, pickup_lat, pickup_lng, pickup_note, is_active, service_areas:area_id (name)')
    .limit(1)
    .maybeSingle()

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Shop settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Contact the office to change these details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Owner" value={profile.full_name} />
          <Row label="Phone" value={formatMyanmarPhone(profile.phone)} />
          <Row label="Language" value={profile.preferred_lang === 'my' ? 'Burmese' : 'English'} />
        </CardContent>
      </Card>

      {shop ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{shop.name}</CardTitle>
            <CardDescription>{shop.pickup_address}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Shop phone" value={formatMyanmarPhone(shop.phone)} />
            <Row label="Ward" value={(shop.service_areas as { name: string } | null)?.name ?? '—'} />
            {shop.pickup_note ? <Row label="Pickup note" value={shop.pickup_note} /> : null}
            <div className="h-52 overflow-hidden rounded-md border">
              <MapCanvas
                center={{ lat: shop.pickup_lat, lng: shop.pickup_lng }}
                zoom={16}
                interactive={false}
                markers={[
                  {
                    id: 'shop',
                    point: { lat: shop.pickup_lat, lng: shop.pickup_lng },
                    kind: 'pickup',
                    label: shop.name,
                  },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert tone="error" title="No shop registered">
          Ask the Mingalar Express office to register your shop and pickup point.
        </Alert>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
