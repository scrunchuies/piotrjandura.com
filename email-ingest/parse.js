const moneyRe =
  "\\$([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)";

const skipPatterns = [
  /is requesting/i,
  /requested \$/i,
  /wants \$/i,
  /charge request/i,
  /unfinished payment/i,
  /verify your/i,
  /reset your password/i,
  /weekly summary/i,
  /transaction history/i,
  /security (code|alert)/i,
];

const stripSubject = (subject) =>
  String(subject || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[＄]/g, "$")
    .replace(/^(?:(?:fwd|fw|re|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();

const parseAmount = (raw) => Number(String(raw).replace(/,/g, ""));

const cleanName = (raw) =>
  String(raw || "")
    .replace(/\s+on venmo\s*$/i, "")
    .replace(/\s+via venmo\s*$/i, "")
    .replace(/["""']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");

const firstName = (raw) => {
  const name = cleanName(raw);
  if (!name) return "";
  if (/^bank transfer$/i.test(name)) return "Bank transfer";
  const token = name.split(/\s+/)[0];
  if (/^doan$/i.test(token)) return "Lucia";
  return token;
};

const firstMatch = (text, patterns) => {
  for (const { re, map } of patterns) {
    const m = text.match(re);
    if (m) return map(m);
  }
  return null;
};

const parseVenmoEmail = ({ subject = "", text = "" } = {}) => {
  const cleaned = stripSubject(subject);
  const body = String(text || "").replace(/<[^>]+>/g, " ");
  const haystack = `${cleaned}\n${body}`.slice(0, 8000);

  if (skipPatterns.some((re) => re.test(haystack))) {
    const completed = /(?:paid|payed|sent) you(?:r)? \$/i.test(cleaned) ||
      /^you received \$/i.test(cleaned);
    if (!completed) return null;
  }

  const received = firstMatch(cleaned, [
    {
      re: new RegExp(`you received ${moneyRe} from (.+?)(?:\\s+on venmo)?$`, "i"),
      map: (m) => ({ type: "received", amount: parseAmount(m[1]), from: firstName(m[2]) }),
    },
    {
      re: new RegExp(
        `^(.+?) (?:paid|payed|sent) your ${moneyRe} request`,
        "i"
      ),
      map: (m) => ({ type: "received", amount: parseAmount(m[2]), from: firstName(m[1]) }),
    },
    {
      re: new RegExp(
        `^(.+?) (?:paid|payed|sent) you ${moneyRe}(?:\\b|\\s|$)`,
        "i"
      ),
      map: (m) => ({ type: "received", amount: parseAmount(m[2]), from: firstName(m[1]) }),
    },
    {
      re: new RegExp(
        `you added ${moneyRe}(?: to(?: your)? venmo(?: balance| account)?)?`,
        "i"
      ),
      map: (m) => ({
        type: "received",
        amount: parseAmount(m[1]),
        from: "Bank transfer",
      }),
    },
    {
      re: new RegExp(
        `(?:your )?(?:bank )?transfer of ${moneyRe}.*from`,
        "i"
      ),
      map: (m) => ({
        type: "received",
        amount: parseAmount(m[1]),
        from: "Bank transfer",
      }),
    },
  ]);

  const sent = firstMatch(cleaned, [
    {
      re: new RegExp(`you (?:paid|payed|sent) (.+?) ${moneyRe}(?:\\b|\\s|$)`, "i"),
      map: (m) => ({ type: "sent", amount: parseAmount(m[2]), to: firstName(m[1]) }),
    },
    {
      re: new RegExp(`you (?:paid|sent) ${moneyRe} to (.+)$`, "i"),
      map: (m) => ({ type: "sent", amount: parseAmount(m[1]), to: firstName(m[2]) }),
    },
    {
      re: new RegExp(
        `(?:your )?transfer of ${moneyRe}.*(?:to (?:your )?bank|cashed out)`,
        "i"
      ),
      map: (m) => ({ type: "sent", amount: parseAmount(m[1]), to: "Bank transfer" }),
    },
    {
      re: new RegExp(`(?:your )?transfer of ${moneyRe} is complete`, "i"),
      map: (m) => ({
        type: "received",
        amount: parseAmount(m[1]),
        from: "Bank transfer",
      }),
    },
  ]);

  const tx =
    received ||
    sent ||
    firstMatch(haystack, [
      {
        re: new RegExp(
          `([A-Za-z][A-Za-z .'-]{0,60}?) (?:paid|payed|sent) you ${moneyRe}`,
          "i"
        ),
        map: (m) => ({
          type: "received",
          amount: parseAmount(m[2]),
          from: firstName(m[1]),
        }),
      },
    ]);
  if (!tx || !tx.amount || Number.isNaN(tx.amount)) return null;

  const noteMatch =
    body.match(/(?:note|for|memo)[:\s]+(.{1,80})/i) ||
    cleaned.match(/\s[—–-]\s+(.{1,80})$/);
  const note = noteMatch ? cleanName(noteMatch[1]) : "";

  const balanceMatch = haystack.match(
    new RegExp(`(?:venmo )?balance(?: is|:)\\s*${moneyRe}`, "i")
  );

  return {
    ...tx,
    note: note && !/^https?:/i.test(note) ? note : "",
    reportedBalance: balanceMatch ? parseAmount(balanceMatch[1]) : null,
  };
};

if (typeof module === "object") module.exports = { parseVenmoEmail, stripSubject };
