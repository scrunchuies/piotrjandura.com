const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVenmoEmail } = require("./parse.js");

test("received from subject", () => {
  const tx = parseVenmoEmail({
    subject: "You received $24.50 from Alex Kim",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.amount, 24.5);
  assert.equal(tx.from, "Alex");
});

test("paid you, including forwarded prefix", () => {
  const tx = parseVenmoEmail({
    subject: "Fwd: Jordan Patel paid you $15.00",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.amount, 15);
  assert.equal(tx.from, "Jordan");
});

test("paid you $1 without cents or trailing junk", () => {
  const tx = parseVenmoEmail({
    subject: "Piotr Jandura paid you $1",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.amount, 1);
  assert.equal(tx.from, "Piotr");
});

test("paid you with trailing on Venmo", () => {
  const tx = parseVenmoEmail({
    subject: "Piotr Jandura paid you $1.00 on Venmo",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.amount, 1);
  assert.equal(tx.from, "Piotr");
});

test("you paid", () => {
  const tx = parseVenmoEmail({
    subject: "You paid Sam Lee $12.00",
  });
  assert.equal(tx.type, "sent");
  assert.equal(tx.amount, 12);
  assert.equal(tx.to, "Sam");
});

test("skips payment requests", () => {
  assert.equal(
    parseVenmoEmail({ subject: "Alex is requesting $20.00" }),
    null
  );
});

test("paid your charge request is a completed fine", () => {
  const tx = parseVenmoEmail({
    subject: "Hayden Nguyen paid your $5.00 request",
    text: "You requested $5.00 from Hayden Nguyen. Hayden Nguyen paid you $5.00",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.amount, 5);
  assert.equal(tx.from, "Hayden");
});

test("bank cash-out", () => {
  const tx = parseVenmoEmail({
    subject: "Your transfer of $50.00 to your bank is complete",
  });
  assert.equal(tx.type, "sent");
  assert.equal(tx.to, "Bank transfer");
  assert.equal(tx.amount, 50);
});

test("bank add to Venmo", () => {
  const tx = parseVenmoEmail({
    subject: "Your transfer of $50.00 is complete",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.from, "Bank transfer");
  assert.equal(tx.amount, 50);
});

test("you added to Venmo", () => {
  const tx = parseVenmoEmail({
    subject: "You added $20.00 to your Venmo balance",
  });
  assert.equal(tx.type, "received");
  assert.equal(tx.from, "Bank transfer");
  assert.equal(tx.amount, 20);
});

test("Doan becomes Lucia", () => {
  const tx = parseVenmoEmail({
    subject: "You received $5.00 from Doan Nguyen",
  });
  assert.equal(tx.from, "Lucia");
});
