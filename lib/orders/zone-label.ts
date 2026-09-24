/**
 * How a shop sees where a parcel is going: the township and its ZONE.
 *
 * NEVER THE WAY. Ways ("Way 1 — Downtown") are how the office splits the day
 * into runs, and since 0049 the office chooses them by hand -- so the way an
 * area maps to by default is not even the way the parcel will ride. Showing it
 * on the booking form told shops something internal and, often, untrue. The
 * zone is what they are actually charged by, so that is what they see.
 */

type ZoneFields = {
  areaName: string
  areaNameMm: string | null
  zoneCode: string
  zoneName: string
  zoneNameMm: string | null
}

type Locale = 'my' | 'en'

const MY_DIGITS = ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉']

/**
 * "Zone 1" from ZONE_1, in the shop's language.
 *
 * From the CODE rather than the zone's name, because the name carries a
 * description ("Zone 1 — inner Yangon") that is too long beside a township in
 * a dropdown. A code that does not look like ZONE_<n> falls back to the name.
 */
export function zoneShort(z: Pick<ZoneFields, 'zoneCode' | 'zoneName' | 'zoneNameMm'>, locale: Locale): string {
  const n = /^ZONE_(\d+)$/.exec(z.zoneCode)?.[1]
  if (locale === 'my') {
    if (z.zoneNameMm) return z.zoneNameMm
    if (n) return `ဇုန် ${n.replace(/\d/g, (d) => MY_DIGITS[Number(d)]!)}`
    return z.zoneName
  }
  return n ? `Zone ${n}` : z.zoneName
}

/** The township in the shop's language. */
export function areaDisplayName(z: Pick<ZoneFields, 'areaName' | 'areaNameMm'>, locale: Locale): string {
  return locale === 'my' && z.areaNameMm ? z.areaNameMm : z.areaName
}

/** One dropdown option: "Downtown — Zone 1". */
export function areaZoneLabel(z: ZoneFields, locale: Locale): string {
  return `${areaDisplayName(z, locale)} — ${zoneShort(z, locale)}`
}

/** A dropdown group heading: the zone's full name, e.g. "Zone 1 — inner Yangon". */
export function zoneGroupLabel(z: Pick<ZoneFields, 'zoneName' | 'zoneNameMm'>, locale: Locale): string {
  return locale === 'my' && z.zoneNameMm ? z.zoneNameMm : z.zoneName
}
