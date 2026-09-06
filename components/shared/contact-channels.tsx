import { Facebook, MessageCircle, Music, Phone, Send } from 'lucide-react'
import type { ContactChannel, ContactChannelId } from '@/lib/contact/channels'
import { cn } from '@/lib/utils'

/**
 * One tappable row per way of reaching the office.
 *
 * ABOUT THE ICONS. lucide-react 0.545 ships `Facebook` and nothing for Viber,
 * Telegram or TikTok — no icon set in this project has them. Drawing brand
 * marks from memory risks shipping a subtly wrong logo, which looks worse than
 * a generic glyph, so recognition is carried by the channel's own colour and by
 * its name in plain text. Swap in the official SVGs here when they are to hand;
 * nothing else has to change.
 */
const ICON: Record<ContactChannelId, typeof Phone> = {
  phone: Phone,
  viber: MessageCircle,
  telegram: Send,
  facebook: Facebook,
  tiktok: Music,
}

/**
 * Brand colours as inline styles rather than Tailwind classes: these are four
 * fixed hexes belonging to other companies, not part of this design system, and
 * putting them in `globals.css` would imply they are themeable. They are not —
 * Viber purple is Viber purple in both light and dark.
 */
const TINT: Record<ContactChannelId, string> = {
  phone: 'var(--brand-red)',
  viber: '#7360F2',
  telegram: '#26A5E4',
  facebook: '#1877F2',
  tiktok: 'var(--charcoal)',
}

export function ContactChannelRow({ channel }: { channel: ContactChannel }) {
  const Icon = ICON[channel.id]

  return (
    <a
      href={channel.href}
      // `tel:` and `viber:` hand off to an app on the same device — opening a
      // tab for those leaves an empty one behind.
      {...(channel.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: TINT[channel.id] }}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{channel.name}</span>
        {channel.detail ? (
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {channel.detail}
          </span>
        ) : null}
      </span>
    </a>
  )
}

export function ContactChannelList({
  channels,
  className,
}: {
  channels: ContactChannel[]
  className?: string
}) {
  if (channels.length === 0) return null
  return (
    <div className={cn('grid gap-2', className)}>
      {channels.map((c) => (
        <ContactChannelRow key={c.key} channel={c} />
      ))}
    </div>
  )
}
