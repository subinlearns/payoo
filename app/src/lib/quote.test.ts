import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQuote, feeForAmount, usdcForInvoice } from "./quote.ts";

test("usdcForInvoice matches the on-chain rounding", () => {
  // Same vectors as the Rust unit tests in programs/payoo-escrow
  assert.equal(usdcForInvoice(1_000_000, 7_000_000), 1_428_571_429);
  assert.equal(usdcForInvoice(700, 7_000_000), 1_000_000);
});

test("fee uses floor like the program", () => {
  assert.equal(feeForAmount(1_428_571_429, 100), 14_285_714);
});

test("quote totals add up and beat a bank wire", () => {
  const q = computeQuote({ invoiceCnyFen: 500_000, usdCny: 7.1, usdNpr: 140 });
  assert.equal(q.totalNprPaisa, q.principalNprPaisa + q.feeNprPaisa);
  assert.ok(q.spreadNprPaisa > 0);
  assert.ok(q.savingsNprPaisa > 0, "Payoo should be cheaper than the bank wire estimate");
  // ¥5,000 at 7.1 ≈ $704.23
  assert.equal(q.amountUsdc, usdcForInvoice(500_000, 7_100_000));
});

test("rejects bad input", () => {
  assert.throws(() => computeQuote({ invoiceCnyFen: 0, usdCny: 7, usdNpr: 140 }));
  assert.throws(() => computeQuote({ invoiceCnyFen: 100, usdCny: 0, usdNpr: 140 }));
});
