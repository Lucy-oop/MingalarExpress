/**
 * Every string the rider app shows, in both languages.
 *
 * SCOPE, stated plainly: this covers the RIDER app and the shared header. The
 * shop panel and the admin screens are still English-only, and a switcher that
 * flipped a locale and left them untouched would look broken — so the toggle is
 * mounted in the rider shell first, and the shop panel is the next pass.
 *
 * FLAT KEYS, PAIRED VALUES. `{ en, my }` sits together on one line rather than
 * two parallel trees, so a missing translation is impossible to introduce: the
 * type demands both. `dictionary.test.ts` also checks that no value is blank and
 * that placeholders match between the pair, which is the other way this drifts.
 *
 * BURMESE FIRST. `my` is the default locale, not a fallback — most riders in
 * Yangon read Burmese far more comfortably than English, and the phone this runs
 * on is theirs, not the office's.
 *
 * Keep the Burmese SHORT. These render on a 5-inch screen inside buttons sized
 * for a thumb in the rain; a phrase that wraps to three lines is worse than a
 * blunter word that fits.
 */

export const DICTIONARY = {
  // ---- shell ----------------------------------------------------------------
  'app.rider': { en: 'Mingalar Express rider', my: 'Mingalar Express ရိုက်ဒါ' },
  'nav.jobs': { en: 'Jobs', my: 'အလုပ်' },
  'nav.earnings': { en: 'Earnings', my: 'ဝင်ငွေ' },
  'action.signOut': { en: 'Sign out', my: 'ထွက်' },
  'lang.label': { en: 'Language', my: 'ဘာသာစကား' },

  // ---- day summary ----------------------------------------------------------
  'stat.earnedToday': { en: 'Earned today', my: 'ဒီနေ့ ဝင်ငွေ' },
  'stat.delivered': { en: 'Delivered', my: 'ပို့ပြီး' },
  'stat.collected': { en: 'Picked up', my: 'ယူပြီး' },
  'stat.cashHeld': { en: 'Cash held', my: 'ကိုင်ထားသည်' },
  'cash.warning': {
    en: 'You are holding {amount} of company cash. Hand it in at the end of your shift.',
    my: 'ကုမ္ပဏီငွေ {amount} ကိုင်ထားပါသည်။ အလုပ်ဆင်းချိန် အပ်ပါ။',
  },

  // ---- the run --------------------------------------------------------------
  'run.onTheRoad': { en: 'On the road', my: 'လမ်းပေါ်' },
  'run.atHub': { en: 'Back at hub', my: 'ဌာနပြန်ရောက်' },
  'run.loading': { en: 'Loading at hub', my: 'ဌာနတွင် တင်နေ' },
  'run.waitForDispatch': { en: 'Wait for dispatch to send the run out.', my: 'ရုံးမှ ခွင့်ပြုသည်အထိ စောင့်ပါ။' },
  'run.toDeliver': { en: '{n} to deliver', my: 'ပို့ရန် {n}' },
  'run.toCollect': { en: '{n} to collect', my: 'ယူရန် {n}' },

  // ---- job list -------------------------------------------------------------
  'jobs.next': { en: 'Next stop', my: 'လာမည့်နေရာ' },
  'jobs.remaining': { en: 'After this', my: 'ဒီပြီးရင်' },
  'jobs.none': { en: 'Nothing to do right now', my: 'အလုပ်မရှိပါ' },
  'jobs.noneHint': { en: 'Dispatch will put you on a run.', my: 'ရုံးမှ အလုပ်ပေးပါမည်။' },
  'jobs.noneOffline': { en: 'Go online so dispatch can put you on a run.', my: 'အလုပ်ရရန် အွန်လိုင်းဖွင့်ပါ။' },
  'jobs.noneLoading': { en: 'Your run has no parcels loaded yet.', my: 'သင့်အလုပ်တွင် ပါဆယ် မတင်ရသေးပါ။' },
  'jobs.newWork': { en: '+{n} to deliver', my: 'ပို့ရန် +{n}' },
  'jobs.newWorkOne': { en: '+1 parcel to deliver', my: 'ပါဆယ် +၁ ပို့ရန်' },

  // ---- a parcel -------------------------------------------------------------
  'parcel.deliverTo': { en: 'Deliver to', my: 'ပို့ရမည့်နေရာ' },
  'parcel.pickUp': { en: 'Pick up', my: 'ယူရမည့်နေရာ' },
  'parcel.returnTo': { en: 'Return to shop', my: 'ဆိုင်ကို ပြန်ပို့' },
  'parcel.pickupBadge': { en: 'Pickup', my: 'ယူရန်' },
  'parcel.returnBadge': { en: 'Return', my: 'ပြန်ပို့' },
  'parcel.fragile': { en: 'Fragile', my: 'ကွဲလွယ်' },
  'parcel.contents': { en: 'Parcel', my: 'ပါဆယ်' },

  // ---- money ----------------------------------------------------------------
  'money.collect': { en: 'Collect from customer', my: 'ဝယ်သူဆီမှ ကောက်ခံရန်' },
  'money.goods': { en: 'Goods', my: 'ကုန်ပစ္စည်း' },
  'money.fee': { en: 'Delivery fee', my: 'ပို့ဆောင်ခ' },
  'money.feeOnShop': { en: 'billed to the shop', my: 'ဆိုင်မှ ပေးမည်' },
  'money.total': { en: 'Total at the door', my: 'စုစုပေါင်း' },
  'money.prepaid': { en: 'Prepaid', my: 'ငွေရှင်းပြီး' },
  'money.collectNothing': { en: 'Collect nothing at the door.', my: 'ငွေ ကောက်ခံရန် မလိုပါ။' },
  'money.youEarn': { en: 'You earn', my: 'သင်ရမည့်ငွေ' },

  // ---- actions --------------------------------------------------------------
  'action.call': { en: 'Call', my: 'ဖုန်းဆက်' },
  'action.navigate': { en: 'Directions', my: 'လမ်းကြည့်' },
  'action.markPickedUp': { en: 'I HAVE THE PARCEL', my: 'ပါဆယ် ယူပြီးပါပြီ' },
  'action.markDelivered': { en: 'DONE — DELIVERED', my: 'ပို့ပြီးပါပြီ' },
  'action.markReturned': { en: 'RETURNED TO SHOP', my: 'ဆိုင်ကို ပြန်အပ်ပြီး' },
  'action.takePhoto': { en: 'TAKE PHOTO', my: 'ဓာတ်ပုံ ရိုက်ပါ' },
  'action.retakePhoto': { en: 'Retake', my: 'ပြန်ရိုက်' },
  'action.preparing': { en: 'Preparing photo…', my: 'ဓာတ်ပုံ ပြင်နေသည်…' },
  'action.saving': { en: 'Saving…', my: 'သိမ်းနေသည်…' },
  'action.saved': { en: 'Saved', my: 'သိမ်းပြီး' },
  'action.cannotDeliver': { en: 'Cannot deliver this', my: 'ပို့မရပါ' },
  'action.confirmFailed': { en: 'Confirm', my: 'အတည်ပြု' },
  'action.cancel': { en: 'Back', my: 'ပြန်' },
  'action.refresh': { en: 'Refresh', my: 'ပြန်ဖွင့်' },

  // ---- proof ----------------------------------------------------------------
  'proof.title': { en: 'Photo of the delivery', my: 'ပို့ပြီးဓာတ်ပုံ' },
  'proof.required': { en: 'A photo is needed before you can finish.', my: 'ဓာတ်ပုံ ရိုက်ပြီးမှ ပြီးဆုံးနိုင်ပါမည်။' },
  'proof.receiver': { en: 'Who received it?', my: 'ဘယ်သူ လက်ခံသလဲ' },
  'proof.receiverOptional': { en: 'optional', my: 'မထည့်လည်းရ' },
  'proof.returnReceiver': { en: 'Who at the shop took it back?', my: 'ဆိုင်မှ ဘယ်သူ လက်ခံသလဲ' },
  'proof.returnReceiverRequired': { en: 'Write who at the shop took it back.', my: 'ဆိုင်မှ လက်ခံသူ နာမည် ထည့်ပါ။' },

  // ---- failure --------------------------------------------------------------
  'fail.title': { en: 'What went wrong?', my: 'ဘာဖြစ်သလဲ' },
  'fail.placeholder': { en: 'Customer not home, phone off, wrong address…', my: 'အိမ်မရှိ၊ ဖုန်းပိတ်၊ လိပ်စာမှား…' },
  'fail.required': { en: 'Say what went wrong.', my: 'ဘာဖြစ်သည် ရေးပါ။' },
  'fail.photoFirst': { en: 'Take a photo of the delivery first.', my: 'ဓာတ်ပုံ အရင်ရိုက်ပါ။' },

  // ---- earnings -------------------------------------------------------------
  'earnings.title': { en: 'Earnings', my: 'ဝင်ငွေ' },
  'earnings.week': { en: 'This week', my: 'ဒီအပတ်' },
  'earnings.activeJobs': { en: 'On the bike now', my: 'လက်ရှိ ကိုင်ထား' },
  'earnings.empty': { en: 'Nothing yet. Completed deliveries appear here.', my: 'မရှိသေးပါ။ ပို့ပြီးသည်များ ဒီတွင် ပေါ်ပါမည်။' },

  // ---- online ---------------------------------------------------------------
  'online.on': { en: 'Working', my: 'အလုပ်လုပ်နေ' },
  'online.off': { en: 'Not working', my: 'အလုပ်မလုပ်' },
  'online.goOn': { en: 'START WORK', my: 'အလုပ် စမည်' },
  'online.goOff': { en: 'Stop for today', my: 'ဒီနေ့ ရပ်မည်' },
  'online.visible': { en: 'Dispatch can see you', my: 'ရုံးမှ မြင်နိုင်ပါသည်' },
  'online.tapToStart': { en: 'Tap to start work', my: 'အလုပ်စရန် နှိပ်ပါ' },
  'online.gpsLocked': { en: 'GPS on', my: 'GPS ရပါသည်' },
  'online.gpsWaiting': { en: 'Waiting for GPS…', my: 'GPS စောင့်နေသည်…' },

  // ---- offline --------------------------------------------------------------
  'offline.saved': {
    en: 'No signal — saved on your phone. It will send when you reconnect.',
    my: 'အင်တာနက် မရပါ — ဖုန်းတွင် သိမ်းထားပြီး။ ပြန်ရလျှင် အလိုအလျောက် ပို့ပါမည်။',
  },
} as const

export type MessageKey = keyof typeof DICTIONARY
