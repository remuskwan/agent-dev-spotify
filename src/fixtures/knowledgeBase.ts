export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    id: "kb-001",
    title: "Subscription Plans & Pricing",
    content:
      "We offer four plans: Free (ad-supported, no offline, $0/mo), Individual ($9.99/mo, 1 account, offline, no ads), " +
      "Duo ($12.99/mo, 2 accounts, must live at same address), and Family ($15.99/mo, up to 6 accounts, parental controls). " +
      "All prices are in USD. Prices may vary by region.",
    tags: ["plan", "plans", "pricing", "price", "subscription", "individual", "duo", "family", "free", "upgrade", "downgrade"],
  },
  {
    id: "kb-002",
    title: "Cancellation Policy",
    content:
      "You can cancel your subscription at any time. After cancellation, you retain access until the end of your current " +
      "billing cycle. You will not be charged again after cancellation. Cancellations take effect at the next billing date. " +
      "Your account reverts to the Free tier when the paid period ends.",
    tags: ["cancel", "cancellation", "end", "stop", "terminate", "subscription"],
  },
  {
    id: "kb-003",
    title: "Refund Policy",
    content:
      "Refunds are available within 7 days of a charge if you have not used the service substantially during that period. " +
      "Maximum refund per request is $50.00. Only one refund is issued per 90-day period. Refunds are returned to the " +
      "original payment method within 5–10 business days. Promotional charges and gift card purchases are non-refundable.",
    tags: ["refund", "refunds", "money", "charge", "charged", "billing", "payment", "7 days"],
  },
  {
    id: "kb-004",
    title: "Device Limit Policy",
    content:
      "You can install the app on unlimited devices, but you can only stream on 1 device at a time (Individual plan). " +
      "Duo and Family plans allow streaming on 2 and 6 devices simultaneously respectively. " +
      "Offline downloads are limited to 5 devices per account. To remove a device, go to Account Settings > Devices.",
    tags: ["device", "devices", "offline", "download", "stream", "simultaneous", "limit"],
  },
  {
    id: "kb-005",
    title: "Playback Troubleshooting",
    content:
      "Common playback fixes: (1) Check your internet connection speed (minimum 1 Mbps for normal quality, 5 Mbps for high). " +
      "(2) Log out and log back in to refresh your session. (3) Clear the app cache in Settings > Storage. " +
      "(4) Reinstall the app if issues persist. (5) For offline playback, ensure downloads are complete and you've been " +
      "online in the last 30 days to re-validate licenses.",
    tags: ["playback", "play", "streaming", "quality", "buffering", "offline", "download", "slow", "error", "troubleshoot"],
  },
  {
    id: "kb-006",
    title: "Account Security & Unauthorized Access",
    content:
      "If you suspect unauthorized access to your account: (1) Immediately change your password at account.streamify.com/security. " +
      "(2) Sign out of all devices from Account Settings > Security > Sign out everywhere. " +
      "(3) Review recent activity and report any unrecognized charges. " +
      "(4) Enable two-factor authentication for additional protection. Contact support immediately if you cannot access your account.",
    tags: ["security", "hacked", "unauthorized", "access", "password", "reset", "2fa", "two-factor", "fraud", "account takeover"],
  },
  {
    id: "kb-007",
    title: "Payment Methods",
    content:
      "We accept credit and debit cards (Visa, Mastercard, Amex, Discover), PayPal, and gift cards. " +
      "To update your payment method, go to Account Settings > Payment. For security, payment updates are handled " +
      "through a secure, PCI-compliant form — card details are never stored in chat. " +
      "If a payment fails, we retry after 3 and 7 days before suspending the account.",
    tags: ["payment", "card", "credit", "debit", "paypal", "billing", "update", "method", "failed", "declined"],
  },
  {
    id: "kb-008",
    title: "Plan Upgrade & Downgrade",
    content:
      "You can upgrade your plan at any time; the new plan takes effect immediately with prorated billing. " +
      "Downgrading takes effect at the start of your next billing cycle. " +
      "You can change your plan once per billing cycle. To change plans, go to Account Settings > Subscription.",
    tags: ["upgrade", "downgrade", "change", "plan", "switch", "billing", "prorate", "cycle"],
  },
];

export function searchKnowledgeBase(query: string, topK = 3): KnowledgeEntry[] {
  const terms = query.toLowerCase().split(/\s+/);
  const scored = KNOWLEDGE_BASE.map((entry) => {
    const text = (entry.title + " " + entry.content + " " + entry.tags.join(" ")).toLowerCase();
    const score = terms.reduce((acc, term) => {
      const tagMatch = entry.tags.some((t) => t.includes(term)) ? 3 : 0;
      const titleMatch = entry.title.toLowerCase().includes(term) ? 2 : 0;
      const contentMatch = text.includes(term) ? 1 : 0;
      return acc + tagMatch + titleMatch + contentMatch;
    }, 0);
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.entry);
}
