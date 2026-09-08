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
  'parcel.fromShop': { en: 'From', my: 'ပို့သူ' },
  'parcel.returnTo': { en: 'Return to shop', my: 'ဆိုင်ကို ပြန်ပို့' },
  'parcel.pickupBadge': { en: 'Pickup', my: 'ယူရန်' },
  'parcel.returnBadge': { en: 'Return', my: 'ပြန်ပို့' },
  'parcel.fragile': { en: 'Fragile', my: 'ကွဲလွယ်' },
  'parcel.contents': { en: 'Parcel', my: 'ပါဆယ်' },
  /* No coordinates for this place — the shop registered on its address alone
     (0034/0036). Ringing them is how this is actually done in Yangon. */
  'parcel.noPinCall': {
    en: 'No map pin — call to find it',
    my: 'မြေပုံ အမှတ်မရှိ — ဖုန်းဆက်၍ ရှာပါ',
  },

  // ---- money ----------------------------------------------------------------
  'money.collect': { en: 'Collect from customer', my: 'ဝယ်သူဆီမှ ကောက်ခံရန်' },
  'money.goods': { en: 'Goods', my: 'ကုန်ပစ္စည်း' },
  'money.fee': { en: 'Delivery fee', my: 'ပို့ဆောင်ခ' },
  'money.feeOnShop': { en: 'billed to the shop', my: 'ဆိုင်မှ ပေးမည်' },
  'money.total': { en: 'Total at the door', my: 'စုစုပေါင်း' },
  'money.prepaid': { en: 'Prepaid', my: 'ငွေရှင်းပြီး' },
  'money.collectNothing': { en: 'Collect nothing at the door.', my: 'ငွေ ကောက်ခံရန် မလိုပါ။' },
  /* The rider is collecting the delivery fee only — the customer already paid
     the shop for the product. Said so a small total does not look like a bug. */
  'money.feeOnlyHint': {
    en: 'Delivery fee only — the product is already paid.',
    my: 'ပို့ဆောင်ခ သာ — ကုန်ဖိုးကို ရှင်းပြီးပါပြီ။',
  },
  'money.youEarn': { en: 'You earn', my: 'သင်ရမည့်ငွေ' },

  // ---- actions --------------------------------------------------------------
  'action.call': { en: 'Call', my: 'ဖုန်းဆက်' },
  'action.navigate': { en: 'Directions', my: 'လမ်းကြည့်' },
  'action.markPickedUp': { en: 'I HAVE THE PARCEL', my: 'ပါဆယ် ယူပြီးပါပြီ' },
  'action.markDelivered': { en: 'DONE — DELIVERED', my: 'ပို့ပြီးပါပြီ' },
  'action.markReturned': { en: 'RETURNED TO SHOP', my: 'ဆိုင်ကို ပြန်အပ်ပြီး' },
  // 0029: a collection ends when the parcel is aboard, not when it is
  // delivered. "I HAVE THE PARCEL" was reused for both, so the same words
  // covered a shop counter and a hub loading bay.
  'action.markCollected': { en: 'COLLECTED FROM SHOP', my: 'ဆိုင်မှ ယူပြီး' },
  'action.takePhoto': { en: 'TAKE PHOTO', my: 'ဓာတ်ပုံ ရိုက်ပါ' },
  'action.retakePhoto': { en: 'Retake', my: 'ပြန်ရိုက်' },
  'action.preparing': { en: 'Preparing photo…', my: 'ဓာတ်ပုံ ပြင်နေသည်…' },
  'action.saving': { en: 'Saving…', my: 'သိမ်းနေသည်…' },
  'action.saved': { en: 'Saved', my: 'သိမ်းပြီး' },
  'action.cannotDeliver': { en: 'Cannot deliver this', my: 'ပို့မရပါ' },
  'action.confirmFailed': { en: 'Confirm', my: 'အတည်ပြု' },
  'action.cancel': { en: 'Back', my: 'ပြန်' },
  'action.refresh': { en: 'Refresh', my: 'ပြန်ဖွင့်' },

  // ---- one visit to a shop --------------------------------------------------
  //
  //  Ten parcels from one shop were ten stops in the feed, every one showing a
  //  CUSTOMER's address, and twenty-odd taps at one counter to record what was
  //  physically one armful.
  'collection.title': { en: 'Collect from this shop', my: 'ဒီဆိုင်မှ ယူရန်' },
  'collection.count': { en: '{n} parcels', my: 'ပါဆယ် {n}' },
  'collection.countOne': { en: '1 parcel', my: 'ပါဆယ် ၁' },
  'collection.callShop': { en: 'Call shop', my: 'ဆိုင်ကို ဖုန်းဆက်' },
  'collection.tickHint': {
    en: 'Untick anything the shop did not hand over.',
    my: 'ဆိုင်မှ မပေးသည်များကို ဖြုတ်ပါ။',
  },
  'collection.cashAfter': { en: 'Cash aboard after this', my: 'ယူပြီးလျှင် ကိုင်မည့်ငွေ' },
  'collection.nothingTicked': { en: 'Tick at least one parcel.', my: 'ပါဆယ် အနည်းဆုံး ၁ ခု ရွေးပါ။' },
  // Not `action.*`: the count makes it too long for that namespace's 24-unit
  // button rule, and it is the one label that must carry a number.
  // What this stop ADDS, not what the run pays. quote_trip_pay picks its tier
  // by DELIVERY count, so a collection-only run of ten is base 15,000 + 5,000 --
  // and the base belongs to the run, not to any one shop.
  'collection.adds': { en: 'This collection adds', my: 'ဒီယူမှုမှ ထပ်ရမည်' },
  // Reporting is a stronger statement than unticking: it goes on the parcel as
  // an uncollected attempt, and the office sees a shop that keeps being short.
  'collection.short': { en: '{n} not ticked', my: 'မရွေးထား {n}' },
  'collection.report': { en: 'Report as not collected', my: 'မယူရသည် အစီရင်ခံ' },
  'collection.reportWhy': {
    en: 'Shop shut, parcel not ready, wrong label…',
    my: 'ဆိုင်ပိတ်၊ ပါဆယ် အသင့်မရှိ၊ တံဆိပ်မှား…',
  },
  'collection.reportHint': {
    en: 'The office is told, and a shop that keeps being short is flagged.',
    my: 'ရုံးသို့ အသိပေးပါမည်။ မကြာခဏ မပြင်ဆင်သည့် ဆိုင်ကို မှတ်သားပါမည်။',
  },
  'collection.reportSend': { en: 'Send report', my: 'အစီရင်ခံ ပို့ရန်' },
  'collection.collectTicked': { en: 'PICKED UP · {n}', my: 'ယူပြီး · {n}' },

  // ---- proof ----------------------------------------------------------------
  'proof.title': { en: 'Photo of the delivery', my: 'ပို့ပြီးဓာတ်ပုံ' },
  'proof.required': { en: 'A photo is needed before you can finish.', my: 'ဓာတ်ပုံ ရိုက်ပြီးမှ ပြီးဆုံးနိုင်ပါမည်။' },
  'proof.receiver': { en: 'Who received it?', my: 'ဘယ်သူ လက်ခံသလဲ' },
  'proof.receiverOptional': { en: 'optional', my: 'မထည့်လည်းရ' },
  'proof.returnReceiver': { en: 'Who at the shop took it back?', my: 'ဆိုင်မှ ဘယ်သူ လက်ခံသလဲ' },
  /*
    A COLLECTION HAS DIFFERENT EVIDENCE, and less of it. There is no customer
    and no doorstep, so "Photo of the delivery" and "Who received it?" were
    both false on a pickup leg.

    NO PHOTO ON A COLLECTION, and not for want of asking. `advance_order` sets
    proof_photo_path with coalesce on EVERY transition, so a photo stored at
    collection time would satisfy both orders_delivered_needs_proof and the
    proof_required guard for the later delivery -- quietly removing the
    requirement to photograph the actual handover. A collection photo is worth
    having, but it needs a column of its own, not this one.
  */
  'proof.shopContact': { en: 'Shop contact name', my: 'ဆိုင်မှ ဆက်သွယ်သူ' },
  'proof.returnReceiverRequired': { en: 'Write who at the shop took it back.', my: 'ဆိုင်မှ လက်ခံသူ နာမည် ထည့်ပါ။' },

  // ---- payment --------------------------------------------------------------
  'pay.how': { en: 'How did the customer pay?', my: 'ဝယ်သူ ဘယ်လို ပေးသလဲ' },
  'pay.cash': { en: 'CASH', my: 'ငွေသား' },
  'pay.kpay': { en: 'KBZPay', my: 'KBZPay' },
  'pay.showQr': { en: 'Show this to the customer', my: 'ဝယ်သူကို ဒီကို ပြပါ' },
  'pay.accountName': { en: 'Account name', my: 'အကောင့်နာမည်' },
  'pay.accountPhone': { en: 'Phone', my: 'ဖုန်း' },
  'pay.amountToSend': { en: 'Amount to transfer', my: 'လွှဲရမည့် ပမာဏ' },
  'pay.receiptTitle': { en: 'Photo of the KBZPay receipt', my: 'KBZPay ပြေစာ ဓာတ်ပုံ' },
  'pay.receiptHint': {
    en: 'The office checks this against the bank before it counts.',
    my: 'ရုံးမှ ဘဏ်နှင့် စစ်ပြီးမှ အတည်ဖြစ်ပါမည်။',
  },
  'pay.receiptRequired': { en: 'Photograph the KBZPay receipt first.', my: 'KBZPay ပြေစာ အရင်ရိုက်ပါ။' },
  'pay.takeReceipt': { en: 'PHOTO OF RECEIPT', my: 'ပြေစာ ရိုက်ပါ' },
  'pay.chooseFirst': { en: 'Choose how the customer paid.', my: 'ပေးချေမှု ရွေးပါ။' },

  // ---- failure --------------------------------------------------------------
  'fail.title': { en: 'What went wrong?', my: 'ဘာဖြစ်သလဲ' },
  'fail.placeholder': { en: 'Customer not home, phone off, wrong address…', my: 'အိမ်မရှိ၊ ဖုန်းပိတ်၊ လိပ်စာမှား…' },
  'fail.required': { en: 'Say what went wrong.', my: 'ဘာဖြစ်သည် ရေးပါ။' },
  // What a rider sees between the shop and the hub. There is no action here:
  // the parcel is aboard and close_trip releases it when the run ends.
  'pickup.aboard': {
    en: 'Aboard. Hand these in at the hub.',
    my: 'ကားပေါ် ရောက်ပြီး။ ဟပ်တွင် အပ်ပါ။',
  },
  // "Customer not home, phone off, wrong address" is nonsense at a counter.
  'fail.pickupPlaceholder': {
    en: 'Shop shut, parcel not ready, wrong label…',
    my: 'ဆိုင်ပိတ်၊ ပါဆယ် အသင့်မရှိ၊ တံဆိပ်မှား…',
  },
  'fail.photoFirst': { en: 'Take a photo of the delivery first.', my: 'ဓာတ်ပုံ အရင်ရိုက်ပါ။' },

  // ---- earnings -------------------------------------------------------------
  'earnings.title': { en: 'Earnings', my: 'ဝင်ငွေ' },
  'earnings.week': { en: 'This week', my: 'ဒီအပတ်' },
  'earnings.activeJobs': { en: 'On the bike now', my: 'လက်ရှိ ကိုင်ထား' },
  // The ledger list was capped at 40 rows with no footnote at all, so a busy
  // rider simply lost the rest without being told.
  'earnings.days': { en: 'Last {n} days', my: 'ပြီးခဲ့သည့် {n} ရက်' },
  'earnings.showing': { en: 'Showing {n} of {total}', my: '{total} ခုမှ {n} ခု' },
  'earnings.narrow': {
    en: 'Narrow the range to see further back.',
    my: 'ပိုရှေးကို ကြည့်ရန် ကာလကို ချုံ့ပါ။',
  },
  'earnings.empty': { en: 'Nothing yet. Completed deliveries appear here.', my: 'မရှိသေးပါ။ ပို့ပြီးသည်များ ဒီတွင် ပေါ်ပါမည်။' },

  // ---- online ---------------------------------------------------------------
  'online.on': { en: 'Working', my: 'အလုပ်လုပ်နေ' },
  'online.off': { en: 'Not working', my: 'အလုပ်မလုပ်' },
  'online.goOn': { en: 'START WORK', my: 'အလုပ် စမည်' },
  'online.goOff': { en: 'Stop for today', my: 'ဒီနေ့ ရပ်မည်' },
  'online.visible': { en: 'Dispatch can see you', my: 'ရုံးမှ မြင်နိုင်ပါသည်' },
  'online.tapToStart': { en: 'Tap to start work', my: 'အလုပ်စရန် နှိပ်ပါ' },
  'online.gpsLocked': { en: 'GPS on', my: 'GPS ရပါသည်' },
  /*
    GPS PERMISSION, which had no key at all and one line of hardcoded English.
    Dispatch places work by where a rider is, and every checkpoint stamps a
    coordinate — so a denied permission is not a degraded experience, it is a
    rider the office cannot see and a delivery with no proof of place.
  */
  'gps.denied': {
    en: 'Location is blocked. Dispatch cannot see you.',
    my: 'တည်နေရာ ပိတ်ထားပါသည်။ ရုံးမှ သင့်ကို မမြင်ပါ။',
  },
  'gps.deniedWhy': {
    en: 'Your stops are stamped with where you were. Turn location on for this site.',
    my: 'သင်ရောက်ခဲ့သည့် တည်နေရာကို မှတ်တမ်းတင်ရပါသည်။ ဒီဆိုဒ်အတွက် တည်နေရာ ဖွင့်ပါ။',
  },
  'gps.allow': { en: 'Turn on location', my: 'တည်နေရာ ဖွင့်ပါ' },
  'gps.howTo': {
    en: 'Blocked earlier? Open your browser settings for this site and allow location.',
    my: 'ယခင် ပိတ်ထားလျှင် ဘရောက်ဇာ setting တွင် ဒီဆိုဒ်အတွက် တည်နေရာ ခွင့်ပြုပါ။',
  },
  'online.gpsWaiting': { en: 'Waiting for GPS…', my: 'GPS စောင့်နေသည်…' },

  // ==========================================================================
  //  SHOP PANEL
  //
  //  A shop owner in Yangon reads Burmese as comfortably as a rider does, and
  //  books parcels on a phone between customers. Same rules as above: short
  //  enough to fit, and the words a shopkeeper actually uses rather than the
  //  words a logistics company uses.
  // ==========================================================================

  'shop.title': { en: 'Mingalar Express shop', my: 'Mingalar Express ဆိုင်' },
  'shop.nav.dashboard': { en: 'Home', my: 'ပင်မ' },
  'shop.nav.orders': { en: 'Parcels', my: 'ပါဆယ်များ' },
  // English says "New Order" because that is what the office calls it; the
  // Burmese stays ပါဆယ် (parcel) rather than the အော်ဒါ loanword, matching every
  // other string in the shop panel.
  'shop.nav.new': { en: 'New Order', my: 'ပါဆယ် တင်ရန်' },
  'shop.nav.money': { en: 'Money', my: 'ငွေစာရင်း' },
  /*
    A SHORT LABEL FOR THE TAB, and the long one kept for prose. 'Shop settings'
    is the longest of the five by a wide margin and it is what pushed the
    Burmese header past its container -- but the two inline uses
    ("...change it in Shop settings") read wrongly as bare 'Settings', so they
    keep the full form. A nav inside the shop app does not need the word shop.
  */
  'shop.nav.settingsTab': { en: 'Settings', my: 'အပြင်အဆင်' },
  'shop.nav.settings': { en: 'Shop settings', my: 'ဆိုင် အပြင်အဆင်' },

  // ---- a parcel moved -------------------------------------------------------
  //
  // `picked_up` means two different things and the shop is told which: on a
  // pickup leg the rider took it off the shop's own counter, on a delivery leg
  // it left the hub for the customer. See lib/orders/parcel-alert.
  'shop.alert.collectedOne': {
    en: 'A rider has collected 1 parcel from your shop',
    my: 'ရိုက်ဒါက သင့်ဆိုင်မှ ပါဆယ် ၁ ခု ယူသွားပါပြီ',
  },
  'shop.alert.collectedMany': {
    en: 'A rider has collected {n} parcels from your shop',
    my: 'ရိုက်ဒါက သင့်ဆိုင်မှ ပါဆယ် {n} ခု ယူသွားပါပြီ',
  },
  'shop.alert.onTheWayOne': {
    en: '1 parcel is on its way to the customer',
    my: 'ပါဆယ် ၁ ခု ဝယ်သူဆီ ထွက်သွားပါပြီ',
  },
  'shop.alert.onTheWayMany': {
    en: '{n} parcels are on their way to customers',
    my: 'ပါဆယ် {n} ခု ဝယ်သူများဆီ ထွက်သွားပါပြီ',
  },
  'shop.alert.movedMany': {
    en: '{n} of your parcels have just moved',
    my: 'သင့်ပါဆယ် {n} ခု လှုပ်ရှားသွားပါပြီ',
  },
  'shop.alert.whileAway': { en: 'while you were away', my: 'သင်မရှိစဉ်' },
  'shop.alert.dismiss': { en: 'Dismiss', my: 'ပိတ်မည်' },

  // ---- booking form ---------------------------------------------------------
  'book.title': { en: 'Book a parcel', my: 'ပါဆယ် တင်ရန်' },
  'book.subtitle': {
    en: 'Four things and a pin on the map.',
    my: 'လေးချက်နှင့် မြေပုံတွင် အမှတ်တစ်ခု။',
  },
  'book.where': { en: 'Where is it going?', my: 'ဘယ်ကို ပို့မလဲ' },
  'book.who': { en: 'Who is receiving it?', my: 'ဘယ်သူ လက်ခံမလဲ' },
  'book.findCustomer': { en: 'Sent to them before? Search name or phone', my: 'အရင်က ပို့ဖူးလား? နာမည် သို့ ဖုန်း ရှာပါ' },
  'book.searching': { en: 'Searching…', my: 'ရှာနေသည်…' },
  'book.noCustomer': { en: 'No past customer matches that.', my: 'ကိုက်ညီသော ဝယ်သူ မတွေ့ပါ။' },
  'book.reused': { en: 'Filled in from a past parcel — check it is still right', my: 'ယခင်ပါဆယ်မှ ထည့်ထားသည် — မှန်မမှန် စစ်ပါ' },
  'book.money': { en: 'Money', my: 'ငွေ' },
  'book.address': { en: 'Delivery address', my: 'ပို့ရမည့် လိပ်စာ' },
  // The address leads now and the pin follows it, so this no longer describes a
  // value arriving from the map.
  'book.addressHint': {
    en: 'Type it, then pick the match to set the map pin',
    my: 'လိပ်စာရိုက်ပြီး ကိုက်ညီသည့်အရာကို ရွေးပါ — မြေပုံအမှတ် အလိုအလျောက် ကျပါမည်',
  },
  'book.area': { en: 'Area', my: 'မြို့နယ်' },
  'book.areaHint': { en: 'Sets the delivery fee', my: 'ပို့ဆောင်ခ သတ်မှတ်ပါမည်' },
  'book.areaChoose': { en: 'Choose an area…', my: 'မြို့နယ် ရွေးပါ…' },
  'book.areaFromAddress': { en: 'Filled in from the address', my: 'လိပ်စာမှ အလိုအလျောက် ထည့်ထားသည်' },
  'book.areaDisagrees': {
    en: 'This address says {area}. Sending it as {chosen} puts it on the wrong run.',
    my: 'ဤလိပ်စာသည် {area} ဟု ဆိုပါသည်။ {chosen} အဖြစ် ပို့လျှင် လမ်းကြောင်း မှားပါမည်။',
  },
  'book.areaUse': { en: 'Use {area} — {fee}', my: '{area} သုံးမည် — {fee}' },
  'book.name': { en: 'Name', my: 'နာမည်' },
  'book.phone': { en: 'Phone', my: 'ဖုန်း' },
  'book.collect': { en: 'Amount to collect', my: 'ကောက်ခံရမည့် ပမာဏ' },
  'book.collectHint': {
    en: 'Price of the goods. Leave 0 if the customer has already paid.',
    my: 'ကုန်ဖိုး။ ဝယ်သူ ငွေရှင်းပြီးလျှင် 0 ထားပါ။',
  },
  'book.codLocked': {
    en: 'This parcel must be prepaid. Cash on delivery unlocks once the office has reviewed your shop — you can keep booking in the meantime.',
    my: 'ဒီပါဆယ်ကို ငွေရှင်းပြီးသား ဖြစ်ရပါမည်။ ရုံးမှ ဆိုင်ကို စစ်ပြီးလျှင် COD ဖွင့်ပါမည် — အခုအချိန်တွင် ဆက်တင်နိုင်ပါသည်။',
  },
  /*
    THREE ANSWERS, because there are three. This was one checkbox — "Already
    paid, collect nothing" — which collapsed "they paid for the product" and
    "they paid for everything" into the same thing. The first of those leaves
    the DELIVERY FEE to be collected at the door, and there was no way to book
    it: the amount field demanded a goods figure, and ticking the box zeroed
    the collection entirely.
  */
  'book.paidQuestion': {
    en: 'What has the customer already paid?',
    my: 'ဝယ်သူ ဘာကို ရှင်းပြီးပြီလဲ',
  },
  'book.paidNothing': { en: 'Nothing yet', my: 'မရှင်းရသေးပါ' },
  'book.paidProduct': {
    en: 'The product only — collect the delivery fee',
    my: 'ကုန်ဖိုးသာ — ပို့ဆောင်ခ ကောက်ပါ',
  },
  'book.paidAll': {
    en: 'Everything — collect nothing',
    my: 'အားလုံး — ငွေ မကောက်ပါ',
  },
  /* Shown under the 'product' choice, so the shop can see what the rider will
     actually ask for before it books. */
  'book.paidProductNote': {
    en: 'The rider collects the delivery fee only. The product is already paid.',
    my: 'ရိုက်ဒါ ပို့ဆောင်ခ ကိုသာ ကောက်ပါမည်။ ကုန်ဖိုးကို ရှင်းပြီးပါပြီ။',
  },
  'book.prepaidNote': { en: 'Already paid — the rider collects nothing.', my: 'ငွေရှင်းပြီး — ရိုက်ဒါ ငွေမကောက်ပါ။' },
  'book.more': { en: 'More details', my: 'အခြား အချက်အလက်' },
  'book.moreHint': { en: 'optional', my: 'မထည့်လည်းရ' },
  'book.submit': { en: 'BOOK THIS PARCEL', my: 'ပါဆယ် တင်မည်' },
  'book.submitting': { en: 'Booking…', my: 'တင်နေသည်…' },

  // ---- why the button is disabled -------------------------------------------
  //
  // One reason at a time, in the order a shop would fix them. These replaced a
  // single generic "drop the pin and choose the area", which was wrong whenever
  // the real problem was the amount — the case that used to book a COD parcel
  // as prepaid.
  'book.alreadyPaid': { en: 'Already paid — collect nothing', my: 'ငွေရှင်းပြီးသား — မကောက်ပါ' },
  // The map is the fallback for an address OSM does not know, not the first
  // step, so this names the suggestion list first.
  'book.pinOutside': {
    en: 'That pin is outside the delivery area.',
    my: 'ဤအမှတ်သည် ပို့ဆောင်နယ်ပယ် အပြင် ဖြစ်ပါသည်။',
  },
  'book.needAddress': { en: 'Add the delivery address.', my: 'ပို့ရမည့် လိပ်စာ ထည့်ပါ။' },
  'book.needArea': { en: 'Choose the area.', my: 'မြို့နယ် ရွေးပါ။' },
  'book.needAmount': {
    en: 'Enter the amount, or tick “already paid”.',
    my: 'ပမာဏ ထည့်ပါ၊ သို့မဟုတ် “ငွေရှင်းပြီးသား” ကို အမှန်ခြစ်ပါ။',
  },
  'book.amtDecimal': {
    en: 'Whole kyat only — no decimal point.',
    my: 'ကျပ်အပြည့်သာ — ဒဿမ မထည့်ပါနှင့်။',
  },
  'book.amtNegative': { en: 'That is a negative amount.', my: 'အနုတ်ဂဏန်း မဖြစ်ရပါ။' },
  'book.amtNotNumber': { en: 'Numbers only.', my: 'ဂဏန်းသာ ထည့်ပါ။' },
  'book.amtTooLarge': {
    en: 'That amount is too large — check it.',
    my: 'ပမာဏ များလွန်းပါသည် — ပြန်စစ်ပါ။',
  },
  'book.pickupOutside': {
    en: 'Your shop location is outside the delivery area. Fix it in shop settings.',
    my: 'ဆိုင်တည်နေရာ ပို့ဆောင်နယ်ပယ် အပြင် ရှိပါသည်။ ဆိုင်အပြင်အဆင်တွင် ပြင်ပါ။',
  },
  'book.failed': { en: 'Could not book this parcel', my: 'ပါဆယ် တင်မရပါ' },

  // ---- optional details -----------------------------------------------------
  'book.altPhone': { en: 'Second phone', my: 'အခြားဖုန်း' },
  'book.contents': { en: 'What is inside', my: 'ဘာပါသလဲ' },
  'book.deliveryNote': { en: 'Note for the rider', my: 'ရိုက်ဒါအတွက် မှတ်ချက်' },
  'book.deliveryNoteHint': { en: 'Gate colour, floor, landmark', my: 'တံခါးအရောင်၊ အထပ်၊ အမှတ်အသား' },
  'book.weight': { en: 'Weight (g)', my: 'အလေးချိန် (g)' },
  'book.declared': { en: 'Declared value (Ks)', my: 'ကြေညာဖိုး (ကျပ်)' },
  'book.fragile': { en: 'Fragile', my: 'ကွဲလွယ်' },
  'book.feePayer': { en: 'Who pays the delivery fee?', my: 'ပို့ဆောင်ခ ဘယ်သူပေးမလဲ' },
  'book.feeCustomer': { en: 'Customer, on delivery', my: 'ဝယ်သူ ပေးမည်' },
  'book.feeShop': { en: 'Me — deduct it from my money', my: 'ကျွန်ုပ် ပေးမည်' },
  'book.pickupFrom': { en: 'Collect from', my: 'ယူရမည့်နေရာ' },
  'book.pickupContact': { en: 'Who to ask for', my: 'ဘယ်သူကို ရှာမလဲ' },
  'book.pickupNote': { en: 'Note for collection', my: 'ယူရန် မှတ်ချက်' },

  // ---- the quote ------------------------------------------------------------
  'quote.goods': { en: 'Goods', my: 'ကုန်ဖိုး' },
  'quote.fee': { en: 'Delivery fee', my: 'ပို့ဆောင်ခ' },
  'quote.total': { en: 'Rider collects', my: 'ရိုက်ဒါ ကောက်ခံမည်' },
  'quote.route': { en: 'Route', my: 'လမ်းကြောင်း' },
  /*
    WAS 'Deducted from your money', which was true and badly framed.

    It appeared in two different situations and described neither well. On a
    PREPAID parcel the shop is simply buying a delivery -- nothing is collected
    at the door and nothing is taken away -- so it read as a penalty on an
    ordinary purchase; that case now gets `quote.youPay` and a total of its own
    instead. On a COD parcel where the shop pays the fee, the fee is netted
    against THIS PARCEL's collection (`owed_to_shop = cod_amount -
    delivery_fee`), not against their balance at large -- which is what "your
    money" sounded like.
  */
  'quote.feeNetted': {
    en: 'Taken from this parcel’s collection',
    my: 'ဒီပါဆယ်၏ ကောက်ခံငွေမှ ခုပါမည်',
  },
  /* The prepaid total, mirroring `quote.total` for COD: one clear number the
     shop is agreeing to, rather than a fee row with a warning beside it. */
  'quote.youPay': { en: 'You pay', my: 'သင် ပေးရမည်' },
  /* Not "0". A zero beside "Goods" reads as a lost amount; this says why the
     collection is only the fee. */
  'quote.goodsPaid': { en: 'already paid', my: 'ရှင်းပြီး' },
  'quote.pickArea': { en: 'Choose an area to see the fee.', my: 'ပို့ဆောင်ခ ကြည့်ရန် မြို့နယ် ရွေးပါ။' },

  // ---- created --------------------------------------------------------------
  'created.title': { en: 'Parcel booked', my: 'ပါဆယ် တင်ပြီးပါပြီ' },
  'created.writeCode': { en: 'Write this code on the parcel', my: 'ဒီကုဒ်ကို ပါဆယ်ပေါ် ရေးပါ' },
  'created.another': { en: 'Book another', my: 'ထပ်တင်မည်' },
  'created.viewOrders': { en: 'See my parcels', my: 'ပါဆယ်များ ကြည့်မည်' },
  'created.print': { en: 'Print label', my: 'လိပ်စာစာရွက် ပရင့်ထုတ်ရန်' },

  // ---- waybill / labels -----------------------------------------------------
  // The label ITSELF is not translated -- it is fixed English scaffolding with
  // the Burmese area name alongside, because a rider and a customer read it,
  // not whoever pressed print. These are the keys for the page AROUND it.
  'label.title': { en: 'Parcel labels', my: 'ပါဆယ် လိပ်စာစာရွက်များ' },
  'label.print': { en: 'Print', my: 'ပရင့်ထုတ်ရန်' },
  'label.back': { en: 'Back to my parcels', my: 'ပါဆယ်များသို့ ပြန်သွားရန်' },
  'label.count': { en: '{n} label(s) · 100 × 150 mm', my: 'လိပ်စာစာရွက် {n} ခု · 100 × 150 mm' },
  'label.none': { en: 'Nothing to print', my: 'ပရင့်ထုတ်စရာ မရှိပါ' },
  'label.noneHint': {
    en: 'These parcels are not yours, or the filters matched nothing.',
    my: 'ဤပါဆယ်များ သင့်ဟာ မဟုတ်ပါ၊ သို့မဟုတ် ကိုက်ညီမှု မရှိပါ။',
  },
  'label.tooMany': {
    en: 'Showing the first {n} only — narrow the dates and print the rest after.',
    my: 'ပထမ {n} ခုသာ ပြသည် — ရက်စွဲ ကျဉ်းအောင်ချုံ့ပြီး ကျန်ကို ထပ်ပရင့်ထုတ်ပါ။',
  },

  // ---- policy ---------------------------------------------------------------
  // The DOCUMENT itself is Burmese only under both toggles and lives in
  // lib/legal/ -- a machine translation of a liability clause is a different
  // contract. These are only the controls around it.
  'policy.title': { en: 'COD advance terms', my: 'COD ငွေကြိုရှင်း စည်းကမ်းချက်များ' },
  'policy.accept': { en: 'I accept', my: 'သဘောတူပါသည်' },
  'policy.accepting': { en: 'Saving…', my: 'သိမ်းနေသည်…' },
  'policy.continue': { en: 'Continue', my: 'ဆက်လက်ဆောင်ရွက်ရန်' },
  'policy.readAll': {
    en: 'I have read all the rules above and agree to them.',
    my: 'အထက်ပါ စည်းကမ်းချက်အားလုံးကို ဖတ်ရှုပြီး သဘောတူပါသည်။',
  },
  'policy.scrollHint': {
    en: 'Scroll to the end to continue',
    my: 'ဆက်လုပ်ရန် အောက်ဆုံးအထိ ဖတ်ပါ',
  },
  'policy.acceptedOn': { en: 'Accepted on {date}', my: '{date} တွင် သဘောတူခဲ့သည်' },
  'policy.notAccepted': { en: 'Not accepted yet', my: 'မသဘောတူရသေးပါ' },
  'policy.readFull': { en: 'Read the full terms', my: 'စည်းကမ်းအပြည့်အစုံ ဖတ်ရန်' },
  'policy.settingsCard': {
    en: 'COD advance settlement',
    my: 'COD ငွေကြိုရှင်းဝန်ဆောင်မှု',
  },
  'policy.settingsHint': {
    en: 'The terms for advancing COD before the customer pays.',
    my: 'ဝယ်သူထံမှ ငွေမရမီ COD ကြိုရှင်းပေးခြင်းဆိုင်ရာ စည်းကမ်းချက်များ။',
  },

  // ---- shop dashboard -------------------------------------------------------
  'sd.waiting': { en: 'Waiting for a rider', my: 'ရိုက်ဒါ စောင့်နေ' },
  'sd.onTheWay': { en: 'On the way', my: 'လမ်းပေါ်' },
  'sd.onTheWayHint': { en: 'Assigned or picked up', my: 'ရိုက်ဒါ ကိုင်ထား' },
  'sd.codInTransit': { en: 'COD in transit', my: 'လမ်းပေါ်ရှိ ငွေ' },
  'sd.codInTransitHint': { en: 'Cash riders are holding', my: 'ရိုက်ဒါ ကိုင်ထားသော ငွေ' },
  'sd.delivered': { en: 'Delivered', my: 'ပို့ပြီး' },
  'sd.needsYou': { en: 'Needs your decision', my: 'သင် ဆုံးဖြတ်ရန်' },
  'sd.recent': { en: 'Recent parcels', my: 'လတ်တလော ပါဆယ်များ' },
  'sd.notSetUp': { en: 'Set up your shop', my: 'သင့်ဆိုင်ကို ပြင်ဆင်ပါ' },
  // Was 'Not able to book yet', which is now the opposite of the truth: an
  // unreviewed shop books prepaid parcels from its first minute.
  'sd.awaiting': { en: 'Cash on delivery not unlocked yet', my: 'COD ကို မဖွင့်ရသေးပါ' },

  // ---- what is holding a shop back ------------------------------------------
  //
  //  These were English string literals in lib/shops/approval.ts, rendered raw
  //  into the alert on the dashboard and on settings while the heading beside
  //  them came from here. On a Burmese phone -- the default -- that produced a
  //  Burmese title over an English paragraph, and the paragraph is the half
  //  that says "you can trade right now".
  //
  //  Titles and bodies both live here now so SHOP_BLOCKED_COPY can pair them.
  //  The dashboard used to hardcode the awaiting title for every state, which
  //  headed a SUSPENDED shop "Cash on delivery not unlocked yet".
  'shop.blocked.awaitingTitle': {
    en: 'Cash on delivery not unlocked yet',
    my: 'COD ကို မဖွင့်ရသေးပါ',
  },
  'shop.blocked.awaiting': {
    en: 'You can book prepaid parcels now. Cash on delivery unlocks once the Mingalar Express office has reviewed your shop.',
    my: 'ငွေရှင်းပြီးသား ပါဆယ်များကို အခုတင်နိုင်ပါသည်။ ရုံးမှ ဆိုင်ကို စစ်ပြီးလျှင် COD ကို ဖွင့်ပေးပါမည်။',
  },
  'shop.blocked.suspendedTitle': { en: 'This shop is suspended', my: 'ဆိုင် ရပ်ဆိုင်းထားပါသည်' },
  'shop.blocked.suspended': {
    en: 'This shop is suspended, so it cannot take new orders. Contact the Mingalar Express office to reactivate it.',
    my: 'ဆိုင်ကို ရပ်ဆိုင်းထားသဖြင့် ပါဆယ်အသစ် တင်လို့မရပါ။ ပြန်ဖွင့်ရန် Mingalar Express ရုံးကို ဆက်သွယ်ပါ။',
  },
  'shop.blocked.rejectedTitle': { en: 'Shop not approved', my: 'ဆိုင်ကို ငြင်းပယ်လိုက်ပါသည်' },
  'shop.blocked.rejected': {
    en: 'This shop was not approved. Contact the Mingalar Express office if you think that is a mistake.',
    my: 'ဆိုင်ကို ခွင့်မပြုပါ။ မှားယွင်းသည်ထင်ပါက Mingalar Express ရုံးကို ဆက်သွယ်ပါ။',
  },
  'shop.codNeedsReview': {
    en: 'Cash on delivery unlocks once the office has reviewed your shop. Book this parcel as prepaid, or contact the office.',
    my: 'ရုံးမှ ဆိုင်ကို စစ်ပြီးလျှင် COD ဖွင့်ပါမည်။ ဒီပါဆယ်ကို ငွေရှင်းပြီးသားအဖြစ် တင်ပါ၊ သို့မဟုတ် ရုံးကို ဆက်သွယ်ပါ။',
  },

  // ---- the pickup pin, when nobody has placed one ---------------------------
  //
  //  0034 lets a shop register on its address alone, because two thirds of
  //  Yangon addresses do not geocode. The parcel is then what cannot be made,
  //  not the account -- orders.pickup_lat is NOT NULL and there is no honest
  //  default for a rider's navigation target. Two wordings because the dashboard
  //  is a reminder and the booking page is a refusal of the parcel in front of
  //  them.
  'shop.noPin.title': { en: 'Add your pickup location', my: 'ယူရမည့် တည်နေရာ ထည့်ပါ' },
  'shop.noPin.body': {
    en: 'We have your address but not the exact spot on the map. Riders need it to collect, so your first parcel is waiting on this. Open Shop settings, tap the locate button while you are at the shop, and save.',
    my: 'သင့်လိပ်စာ ရှိပါသည်၊ ဒါပေမယ့် မြေပုံပေါ်ရှိ တိကျသည့် အမှတ် မရှိသေးပါ။ ရိုက်ဒါ ယူရန် လိုအပ်သဖြင့် ပထမပါဆယ် ဒီအတွက် စောင့်နေပါသည်။ ဆိုင်တွင် ရှိစဉ် ဆိုင် အပြင်အဆင် ထဲမှ တည်နေရာ ခလုတ်ကို နှိပ်၍ သိမ်းပါ။',
  },
  'shop.noPin.cta': { en: 'Set my pickup location', my: 'တည်နေရာ သတ်မှတ်ပါ' },
  'shop.noPin.bookTitle': {
    en: 'Add your pickup location first',
    my: 'အရင် ယူရမည့် တည်နေရာ ထည့်ပါ',
  },
  'shop.noPin.bookBody': {
    en: 'We have your address but not the exact spot on the map, and a rider needs it to collect. Open Shop settings, tap the locate button while you are at the shop or move the pin, and save. You only do this once.',
    my: 'သင့်လိပ်စာ ရှိပါသည်၊ ဒါပေမယ့် မြေပုံပေါ်ရှိ တိကျသည့် အမှတ် မရှိသေးပါ။ ရိုက်ဒါ ယူရန် လိုအပ်ပါသည်။ ဆိုင် အပြင်အဆင် ထဲမှ တည်နေရာ ခလုတ်ကို နှိပ်ပါ သို့မဟုတ် အမှတ်ကို ရွှေ့၍ သိမ်းပါ။ တစ်ခါတည်း လုပ်ရပါသည်။',
  },

  // ---- no shop row at all ---------------------------------------------------
  //
  //  Replaces copy that told the merchant to ring the office and have their
  //  pickup point registered for them. /shop/setup has been self-service since
  //  0026, and they know their own address better than the office does.
  'shop.noShop.title': { en: 'Set up your shop first', my: 'အရင် ဆိုင်ကို ပြင်ဆင်ပါ' },
  'shop.noShop.body': {
    en: 'Your account has no shop yet, so a parcel cannot be created. Tell us your shop name, what you sell and where riders collect from — it takes a minute.',
    my: 'သင့်အကောင့်တွင် ဆိုင် မရှိသေးသဖြင့် ပါဆယ် တင်လို့မရပါ။ ဆိုင်အမည်၊ ဘာရောင်းသည်နှင့် ရိုက်ဒါ ယူရမည့် နေရာကို ပြောပါ — တစ်မိနစ်သာ ကြာပါသည်။',
  },

  // ---- updates --------------------------------------------------------------
  //
  //  What happened to a shop's parcels, read when they open the app. Derived
  //  from order_status_events, so it cannot disagree with the parcels
  //  themselves. NOT a messaging system: 0016 removed the SMS outbox and the
  //  office still rings a shop when something needs deciding.
  'sn.title': { en: 'Updates', my: 'အသိပေးချက်များ' },
  'sn.hint': {
    en: 'What has happened to your parcels. Newest first.',
    my: 'သင့်ပါဆယ်များ၏ အခြေအနေ။ အသစ်ဆုံး အပေါ်တွင်။',
  },
  // The drawer shows the recent ones; 120 events belong on the page.
  'sn.seeAll': { en: 'See all updates', my: 'အားလုံး ကြည့်ရန်' },
  'sn.empty': { en: 'Nothing has happened yet', my: 'ဘာမှ မရှိသေးပါ' },
  'sn.emptyHint': {
    en: 'Once a rider collects or delivers a parcel, it shows here.',
    my: 'ရိုက်ဒါမှ ပါဆယ် ယူပြီး သို့မဟုတ် ပို့ပြီးလျှင် ဒီတွင် ပေါ်ပါမည်။',
  },
  'sn.new': { en: '{n} new', my: 'အသစ် {n}' },
  'sn.collected': { en: 'Collected from you', my: 'သင့်ဆီမှ ယူပြီး' },
  'sn.notCollected': { en: 'Could not be collected', my: 'ယူမရပါ' },
  'sn.deliveryFailed': { en: 'Delivery did not happen', my: 'ပို့မရပါ' },
  'sn.returned': { en: 'Back with you', my: 'သင့်ဆီ ပြန်ရောက်' },
  'sn.delivered': { en: 'Delivered', my: 'ပို့ပြီး' },
  'sn.parcels': { en: '{n} parcels', my: 'ပါဆယ် {n}' },
  'sn.parcelOne': { en: '1 parcel', my: 'ပါဆယ် ၁' },
  'sn.reason': { en: 'Reason given', my: 'အကြောင်းအရင်း' },
  'sn.needsYou': {
    en: 'Some of these are waiting on your decision.',
    my: 'အချို့သည် သင့်ဆုံးဖြတ်ချက်ကို စောင့်နေပါသည်။',
  },

  // ---- shop orders list -----------------------------------------------------
  'so.title': { en: 'My parcels', my: 'ကျွန်ုပ်၏ ပါဆယ်များ' },
  'so.unavailable': { en: 'Parcels unavailable', my: 'ပါဆယ်များ မပြနိုင်ပါ' },
  'so.needsDecision': { en: 'Waiting on your decision', my: 'သင် ဆုံးဖြတ်ရန် ရှိပါသည်' },
  'so.pagination': { en: 'Pagination', my: 'စာမျက်နှာများ' },

  // ---- shop money -----------------------------------------------------------
  'sm.title': { en: 'Money', my: 'ငွေစာရင်း' },
  'sm.subtitle': {
    en: 'Cash collected for you, and what it nets out to.',
    my: 'သင့်အတွက် ကောက်ခံရသော ငွေနှင့် အသားတင် ပမာဏ။',
  },
  'sm.unavailable': { en: 'Money summary unavailable', my: 'ငွေစာရင်း မပြနိုင်ပါ' },
  'sm.inTransit': { en: 'Still in transit', my: 'လမ်းပေါ်' },
  'sm.inTransitHint': { en: 'Not collected yet', my: 'မကောက်ခံရသေး' },
  'sm.collected': { en: 'COD collected', my: 'ကောက်ခံရပြီး' },
  'sm.fees': { en: 'Delivery fees', my: 'ပို့ဆောင်ခ' },
  'sm.feesHint': { en: 'Mingalar’s share', my: 'Mingalar အတွက်' },
  'sm.owed': { en: 'Owed to you', my: 'သင် ရရန်ရှိ' },
  'sm.owedHint': { en: 'Goods value, fees deducted', my: 'ကုန်ဖိုးမှ ပို့ဆောင်ခ ဖြတ်ပြီး' },
  'sm.howWorked': { en: 'How this is worked out', my: 'ဘယ်လို တွက်သလဲ' },
  'sm.notReceived': { en: '{amount} not received', my: '{amount} မရရှိသေးပါ' },

  // ---- shop settings --------------------------------------------------------
  'ss.title': { en: 'Shop settings', my: 'ဆိုင် အပြင်အဆင်' },
  'ss.account': { en: 'Account', my: 'အကောင့်' },
  'ss.owner': { en: 'Owner', my: 'ပိုင်ရှင်' },
  'ss.phone': { en: 'Phone', my: 'ဖုန်း' },
  'ss.language': { en: 'Language', my: 'ဘာသာစကား' },
  'ss.ward': { en: 'Ward', my: 'ရပ်ကွက်' },
  'ss.suspended': { en: 'This shop is suspended', my: 'ဆိုင် ရပ်ဆိုင်းထားပါသည်' },
  'ss.awaiting': { en: 'Cash on delivery not unlocked yet', my: 'COD ကို မဖွင့်ရသေးပါ' },
  'ss.rejected': { en: 'Shop not approved', my: 'ဆိုင်ကို အတည်မပြုပါ' },
  /*
    NOT A WARNING. The old `ss.noPinWarn` was red and it blocked Save, so a shop
    with no map pin could not change its phone number. Saving the address alone
    is fine now; this line only tells them what a pin would add, because the
    booking page links here to set one.
  */
  'ss.pinOptional': {
    en: 'Optional: tap “Use my location” at the shop, or drop the pin on the map, and riders will find you first time. Your address alone saves fine.',
    my: 'ရွေးချယ်နိုင်သည်: ဆိုင်တွင် ရှိစဉ် “ကျွန်ုပ်တည်နေရာ” ကို နှိပ်ပါ သို့မဟုတ် မြေပုံပေါ် အမှတ်ချပါ။ ရိုက်ဒါ ပထမအကြိမ်တွင် ရှာတွေ့ပါမည်။ လိပ်စာသာ သိမ်းလည်း ရပါသည်။',
  },
  'ss.outOfArea': {
    en: 'The pickup pin is outside our delivery area. Move it before saving.',
    my: 'ယူရမည့် အမှတ်သည် ပို့ဆောင်ဝန်းကျင် အပြင်တွင် ရှိပါသည်။ သိမ်းမည့်မတိုင်မီ ရွှေ့ပါ။',
  },
  'ss.addressHint': {
    en: 'This address pre-fills every new order.',
    my: 'ဒီလိပ်စာက ပါဆယ်အသစ်တိုင်းတွင် အလိုအလျောက် ပါဝင်ပါမည်။',
  },
  'ss.help': { en: 'Need help?', my: 'အကူအညီ လိုပါသလား' },
  // Said "call ... during working hours" until the card grew Viber and Telegram
  // rows and an hours line of its own. It named no hours, and "call" stopped
  // being true the moment there was more than one way to get through.
  'ss.helpHint': {
    en: 'The office can help with a parcel, a payment or your account.',
    my: 'ပါဆယ်၊ ငွေပေးချေမှု သို့မဟုတ် အကောင့်ကိစ္စများအတွက် ရုံးမှ ကူညီပေးပါမည်။',
  },
  'ss.noShop': { en: 'No shop registered', my: 'ဆိုင် မမှတ်ပုံတင်ရသေး' },

  // ---- contact us -----------------------------------------------------------
  //
  //  The first PUBLIC page with two languages. The landing, tracking and
  //  offline pages are still English-only hardcoded strings -- but this is the
  //  page somebody reads when a parcel has gone quiet, and Burmese earns more
  //  here than anywhere else on the open web side of the app.
  //
  //  Channel NAMES are deliberately absent: "Viber" is "Viber" in both, and
  //  dictionary.test.ts rightly fails a key whose two languages match. They
  //  live in lib/contact/channels.ts as the proper nouns they are.
  'contact.title': { en: 'Contact us', my: 'ဆက်သွယ်ရန်' },
  'contact.intro': {
    en: 'Ask us about a parcel, a payment, or your shop account.',
    my: 'ပါဆယ်၊ ငွေပေးချေမှု သို့မဟုတ် ဆိုင်အကောင့်အတွက် ဆက်သွယ်မေးမြန်းနိုင်ပါသည်။',
  },
  'contact.call': { en: 'Call the office', my: 'ရုံးကို ဖုန်းခေါ်ရန်' },
  'contact.hours': { en: 'Office hours', my: 'ရုံးဖွင့်ချိန်' },
  'contact.help': { en: 'Message us', my: 'စာပို့ရန်' },
  'contact.helpHint': {
    en: 'Viber is the fastest way to reach the office.',
    my: 'ရုံးသို့ အမြန်ဆုံး ဆက်သွယ်နိုင်သည်မှာ Viber ဖြစ်ပါသည်။',
  },
  'contact.follow': { en: 'Follow us', my: 'ကျွန်ုပ်တို့ကို စောင့်ကြည့်ရန်' },
  'contact.backToSignIn': { en: 'Back to sign in', my: 'အကောင့်ဝင်ရန် ပြန်သွားရန်' },
  // For somebody who arrived already signed in. Offering THEM "Back to sign in"
  // reads as a way to log out, which is the opposite of what the link does.
  // Shop owners get the specific label because they are who actually gets here
  // signed in -- the help card on their settings page is the way in.
  'contact.backToShop': { en: 'Back to my shop', my: 'ကျွန်ုပ်၏ ဆိုင်သို့ ပြန်သွားရန်' },
  'contact.back': { en: 'Go back', my: 'ပြန်သွားရန်' },
  'contact.more': { en: 'More ways to reach us', my: 'အခြား ဆက်သွယ်နည်းများ' },

  // ---- offline --------------------------------------------------------------
  'offline.saved': {
    en: 'No signal — saved on your phone. It will send when you reconnect.',
    my: 'အင်တာနက် မရပါ — ဖုန်းတွင် သိမ်းထားပြီး။ ပြန်ရလျှင် အလိုအလျောက် ပို့ပါမည်။',
  },
} as const

export type MessageKey = keyof typeof DICTIONARY
