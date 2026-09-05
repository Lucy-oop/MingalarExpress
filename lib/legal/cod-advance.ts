/**
 * The COD Advance Settlement Policy, as supplied by the office.
 *
 * A DOCUMENT, NOT UI COPY, which is why it is not in lib/i18n/dictionary.ts:
 * that file is flat `{en, my}` pairs for labels and buttons, and eleven clauses
 * of prose with nested lists would be mangled by it.
 *
 * BURMESE ONLY, UNDER BOTH LANGUAGE TOGGLES. The text assigns real liability --
 * clause 6 puts fraud losses on the shop, clause 8 says advanced COD is not the
 * shop's money yet, clause 10 reserves the right to suspend. A machine
 * translation of any of those is a different contract, so the Burmese stands
 * alone and the buttons around it are what get translated. If an English
 * version is wanted, the office supplies it and it goes in beside this one with
 * its own version string.
 *
 * VERSIONED. Bumping COD_ADVANCE_POLICY_VERSION re-asks every shop, because an
 * acceptance of this wording is not an acceptance of the next one. That is the
 * entire reason `policy_acceptances.version` exists (migration 0023) and the
 * only honest way to change terms somebody has already agreed to.
 */

export const COD_ADVANCE_POLICY_KEY = 'cod_advance'

/**
 * The wording below, dated. Change the text, change this, and everyone is asked
 * again. Never edit the text without moving this.
 */
export const COD_ADVANCE_POLICY_VERSION = '2026-09-05'

export type PolicySection = {
  /** The clause number as written, in Burmese digits. */
  n: string
  heading: string
  paragraphs?: string[]
  bullets?: string[]
  /** Rendered as a warning block — the prohibited-contents list in clause 5. */
  forbidden?: string[]
  footer?: string
}

export type PolicyDocument = {
  key: string
  version: string
  /** BCP-47 tag for the body text, so `:lang(my)` line-height applies. */
  lang: string
  brand: string
  title: string
  subtitle: string
  intro: string
  sections: PolicySection[]
}

export const COD_ADVANCE_POLICY: PolicyDocument = {
  key: COD_ADVANCE_POLICY_KEY,
  version: COD_ADVANCE_POLICY_VERSION,
  lang: 'my',
  brand: 'Mingalar Delivery Service',
  title: 'COD ငွေကြိုရှင်းဝန်ဆောင်မှု စည်းကမ်းချက်များ',
  subtitle: 'COD Advance Settlement Policy',
  intro:
    'Mingalar Delivery Service မှ Online Shop များ၏ ငွေလည်ပတ်မှု ပိုမိုမြန်ဆန်စေရန်အတွက် ' +
    'သတ်မှတ်ချက်များနှင့် ကိုက်ညီသော Online Shop များအား COD ငွေကြိုရှင်းဝန်ဆောင်မှု ' +
    'ပေးအပ်မည်ဖြစ်ပါသည်။',
  sections: [
    {
      n: '၁။',
      heading: 'ဝန်ဆောင်မှုရရှိရန် Shop Verification ပြုလုပ်ရမည်',
      paragraphs: [
        'COD ငွေကြိုရှင်းဝန်ဆောင်မှု ရရှိလိုသော Online Shop များသည် Mingalar Delivery Service သို့ အောက်ပါအချက်အလက်များ ပေးအပ်ရမည်။',
      ],
      bullets: [
        'Shop Owner အမည်',
        'မှတ်ပုံတင်အချက်အလက်',
        'ဆက်သွယ်ရန်ဖုန်းနံပါတ်',
        'Pickup ပြုလုပ်မည့် လိပ်စာ',
        'Online Shop Page / Account',
        'ငွေလွှဲလက်ခံမည့် Bank / Wallet Account',
        'ရောင်းချသည့်ပစ္စည်းအမျိုးအစား',
        'လိုအပ်ပါက အခြားအတည်ပြုချက်များ',
      ],
      footer:
        'Mingalar Delivery Service ၏ Verification အောင်မြင်ပြီးမှသာ COD ကြိုရှင်းခွင့် ပြုမည်ဖြစ်သည်။',
    },
    {
      n: '၂။',
      heading: 'Shop အသစ်များအတွက်',
      paragraphs: [
        'Shop အသစ်များသည် စတင်ဝန်ဆောင်မှုရယူသည့်အချိန်တွင် COD ငွေကြိုရှင်းခွင့်ကို ချက်ချင်းရရှိမည်မဟုတ်ပါ။',
        'ပထမဦးစွာ သတ်မှတ်ထားသော အရေအတွက်အတိုင်း ပုံမှန် Delivery ပြုလုပ်ပြီး—',
      ],
      bullets: [
        'Order မှန်ကန်မှု',
        'Customer အချက်အလက်မှန်ကန်မှု',
        'Delivery အောင်မြင်မှု',
        'Return Rate',
        'Payment History',
        'Shop ၏ ဆက်သွယ်မှုနှင့် တာဝန်ယူမှု',
      ],
      footer: 'တို့ကို စစ်ဆေးပြီးမှ COD Advance ခွင့်ပြုမည်ဖြစ်သည်။',
    },
    {
      n: '၃။',
      heading: 'COD ကြိုရှင်းသည့် Limit',
      paragraphs: [
        'Shop တစ်ဆိုင်ချင်းစီအတွက် COD Advance Limit သတ်မှတ်ပေးမည်ဖြစ်သည်။',
        'ဥပမာ—',
      ],
      bullets: [
        'New / Verified Shop — ၃ သိန်းအထိ',
        'Regular Shop — ၅ သိန်းအထိ',
        'Trusted Partner — သတ်မှတ်ချက်အရ ပိုမိုမြင့်မားသော Limit',
      ],
      footer:
        'သတ်မှတ်ထားသော Limit ထက်ကျော်လွန်သည့် COD ပမာဏကို ကြိုရှင်းပေးမည်မဟုတ်ပါ။ ' +
        'Limit တိုးမြှင့်ခြင်းသည် Shop ၏ Order History နှင့် Risk Assessment ပေါ်မူတည်၍ ' +
        'Mingalar Delivery Service မှ ဆုံးဖြတ်မည်ဖြစ်သည်။',
    },
    {
      n: '၄။',
      heading: 'Order အချက်အလက် မှန်ကန်ရမည်',
      paragraphs: ['COD ကြိုရှင်းမည့် Order တိုင်းတွင် အနည်းဆုံး—'],
      bullets: [
        'Customer Name',
        'Customer Phone',
        'Delivery Address',
        'Product Information',
        'COD Amount',
        'Order ID / Reference',
      ],
      footer:
        'တို့ မှန်ကန်စွာရှိရမည်။ Customer အချက်အလက် မပြည့်စုံသော Order များအား ' +
        'COD ကြိုရှင်းပေးရန် ငြင်းပယ်နိုင်သည်။',
    },
    {
      n: '၅။',
      heading: 'ပစ္စည်းနှင့်ပတ်သက်သော တာဝန်',
      paragraphs: [
        'Parcel အတွင်းရှိ ပစ္စည်းသည် Shop မှ ပေးပို့သည့် ပစ္စည်းဖြစ်ပြီး— ပစ္စည်းအမျိုးအစား၊ အရေအတွက်၊ တန်ဖိုးနှင့် Order မှန်ကန်မှုသည် Shop ၏ တာဝန်ဖြစ်သည်။',
        'အထူးသဖြင့်—',
      ],
      forbidden: [
        'ကျောက်ခဲ',
        'အမှိုက် / တန်ဖိုးမရှိသောပစ္စည်း',
        'မှာယူထားသည့်ပစ္စည်းနှင့် မတူသောပစ္စည်း',
        'ပစ္စည်းမပါသော Parcel',
        'အတုအယောင် Order',
        'တန်ဖိုးလျှော့/လွဲမှားဖော်ပြထားသော Order',
      ],
      footer:
        'များဖြင့် COD Advance ရယူထားကြောင်း တွေ့ရှိပါက Shop ၏ COD Advance ခွင့်ကို ' +
        'ချက်ချင်းရပ်ဆိုင်းနိုင်သည်။',
    },
    {
      n: '🚨 ၆။',
      heading: 'Fraud ဖြစ်ပေါ်ပါက',
      paragraphs: ['အောက်ပါအခြေအနေများ ဖြစ်ပေါ်ပါက—'],
      bullets: [
        'Customer ဖုန်းပိတ်ထားခြင်း / မဆက်သွယ်နိုင်ခြင်း',
        'Shop Owner ကိုယ်တိုင် ဆက်သွယ်၍မရခြင်း',
        'Shop Page / Account ပျောက်သွားခြင်း',
        'ပစ္စည်းအတွင်း ကျောက်ခဲ၊ အမှိုက် သို့မဟုတ် မသက်ဆိုင်သည့်ပစ္စည်းများ တွေ့ရှိခြင်း',
        'Fake Order ပြုလုပ်ထားခြင်း',
        'Shop မှ အချက်အလက်အတု ပေးထားခြင်း',
        'COD Advance ရယူပြီးနောက် တာဝန်ယူဖြေရှင်းခြင်းမရှိခြင်း',
      ],
      footer:
        'စသည်တို့ ဖြစ်ပေါ်ပါက— COD Advance Settlement ကို ချက်ချင်းရပ်ဆိုင်းနိုင်ပြီး ' +
        'ဖြစ်ပေါ်လာသည့် ဆုံးရှုံးမှုများကို Shop ဘက်မှ တာဝန်ယူဖြေရှင်းရမည်။',
    },
    {
      n: '၇။',
      heading: 'Customer မတွေ့ရှိပါက',
      paragraphs: [
        'COD ကြိုရှင်းပြီးသား Order တစ်ခုသည် Customer ထံ Delivery မအောင်မြင်ပါက အဆိုပါ Order ကို အလိုအလျောက် အောင်မြင်ပြီးသော Order ဟု မသတ်မှတ်ပါ။',
        'Mingalar Delivery Service မှ— Return / Failed Delivery / Fraud Risk စစ်ဆေးမှု ပြုလုပ်ပြီးမှ Settlement အခြေအနေကို ဆုံးဖြတ်မည်။',
      ],
    },
    {
      n: '၈။',
      heading: 'ကြိုရှင်းပေးထားသောငွေ ပြန်လည်ရှင်းလင်းခြင်း',
      paragraphs: [
        'COD Advance ရရှိထားသော Order များသည် သတ်မှတ်ထားသည့် Settlement စည်းမျဉ်းများအတိုင်း Mingalar Delivery Service ထံသို့ ပြန်လည်ရှင်းလင်းရမည်။',
        'Advance COD သည် Shop အတွက် အပြီးသတ်ရရှိပြီးသော ရောင်းရငွေမဟုတ်ဘဲ Delivery အောင်မြင်ပြီး Customer ထံမှ COD ပြန်လည်ကောက်ခံနိုင်ရန် ကြိုတင်ရှင်းပေးထားသော ငွေဖြစ်သည်။',
      ],
    },
    {
      n: '၉။',
      heading: 'Advance Service Fee',
      paragraphs: [
        'COD ငွေကြိုရှင်းဝန်ဆောင်မှုအတွက် သတ်မှတ်ထားသော Advance Settlement Service Fee ကောက်ခံနိုင်သည်။',
        'ပုံမှန် Delivery Fee နှင့် COD Advance Fee ကို သီးခြားတွက်ချက်မည်။',
      ],
    },
    {
      n: '၁၀။',
      heading: 'Mingalar ၏ အခွင့်အရေး',
      paragraphs: [
        'Mingalar Delivery Service သည် အောက်ပါအခြေအနေများတွင် COD Advance ကို— ခေတ္တရပ်ဆိုင်းခြင်း / Limit လျှော့ချခြင်း / လုံးဝပိတ်ခြင်း ပြုလုပ်နိုင်သည်။',
      ],
      bullets: [
        'Return Rate မြင့်တက်လာခြင်း',
        'Customer Complaint များလာခြင်း',
        'Order ပုံစံ မမှန်ကန်ခြင်း',
        'Shop နှင့် ဆက်သွယ်ရန် ခက်ခဲလာခြင်း',
        'Fraud Risk မြင့်တက်လာခြင်း',
        'Payment History မကောင်းခြင်း',
        'သတ်မှတ်စည်းကမ်းများ ချိုးဖောက်ခြင်း',
      ],
    },
    {
      n: '🔐 ၁၁။',
      heading: 'အရေးကြီးဆုံး စည်းကမ်း',
      paragraphs: [
        'COD ကြိုရှင်းဝန်ဆောင်မှုသည် Online Shop အားလုံးအတွက် အလိုအလျောက်ရရှိသည့် ဝန်ဆောင်မှုမဟုတ်ပါ။',
        'Shop Verification + Order History + Risk Assessment + COD Advance Limit တို့အပေါ်မူတည်၍ Mingalar Delivery Service မှ ခွင့်ပြုမည်ဖြစ်ပါသည်။',
      ],
    },
  ],
}
