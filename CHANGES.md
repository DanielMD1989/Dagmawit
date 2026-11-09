# DAGMAWIT money app: changes

## 2.1: rewritten in TypeScript (Nov 2026)
Same screens and the same money rules as 2.0. What changed is under the hood:
- **Strict TypeScript.** Every record (order, payment, expense, loan…) has a declared shape, and the build refuses code that misuses one. A mistyped field or icon name is caught before it ships.
- **A build step.** The code lives in `src/`, and `npm run build` produces the **`dist`** folder you upload. `dist` is included, already built.
- **Supabase library bundled.** It's no longer loaded from a CDN when the app starts.
- **Tests:** 26 unit tests (money rules, data upgrade, suggestions, two-phone merge), plus 36 browser checks on the built app (two phones sharing one database, offline edits, every screen). In the browser tests, the real Supabase library talks to a fake server over HTTP.

### Do these once after uploading
1. **Upload the `dist` folder** in place of the old files. The old `app.js` and `js/` folder are no longer used.
2. **Open the app on both phones.** Each phone updates itself on first open. The first phone to open it upgrades the data automatically (see "Your data" below).
3. **Lock access to your two accounts:** run `sql/restrict-access.sql` (instructions inside), then turn off "Allow new users to sign up" in Supabase. Until you do this, anyone who can create an account can read the books.

## 2.0: redesign

### Your data
Nothing is deleted. The upgrade only *adds* information:
- Each order's old "paid so far" total becomes its first **payment**. It is dated the way the old app counted it: the order date, or the delivery date for "on delivery" orders.
- Each loan gets a **date received**, taken from the date it was added.
- Customer measurements and contacts, events, delivery dates and the bag cost setting are all kept as they were.

### How the money is counted now (one set of rules everywhere)
- **Money in** is counted on the day each payment was received. Before, every payment was counted in the month the order was created.
- **Profit** = money in − work expenses.
- **Loans:** borrowed money adds to cash in hand, and repayments take from it. Neither is income or expense, so neither changes profit. (This is how accounting and expense apps treat loans: only interest is a cost. Log interest or fees as a work expense.)
- **Assets** (a machine, a car) take from cash but not from profit.
- **Cash in hand** = money in + borrowed − spent − repaid − assets.
- Because of the loan rule, **cash in hand goes up** by the amount borrowed, and **past profit goes up** by the business loan repayments that used to be counted as costs.

### What's new to use
- **Home:** cash in hand, this month's in / spent / profit, three big buttons (**Got paid**, **Spent**, **New order**), who owes you with a one-tap **Record** button, bills and loans coming up, and recent money movements.
- **Order page:** price, progress, every payment with its date, and **Record payment** and **Remind (SMS)** buttons. Editing is a separate button.
- **Spent:** one form for every cost. The app **suggests work or home** and the category from past entries (e.g. "8 of 8 past Fabric entries were work"; "shop rent" is learned separately from "house rent"). Frequent entries appear as one-tap **Again?** picks.
- **Orders:** Owes / Paid / All filters, oldest debt first.
- **Expenses and Reports:** a month switcher (‹ ›), work vs home totals, spending by category (tap one to see the entries), and a cash summary for the month.
- **Deleting** anything shows an **Undo** button for a few seconds.
- **Two phones** no longer overwrite each other. Changes are merged record by record, including changes made offline.
- **Dates** use Addis Ababa time. Before, entries made between midnight and 3 a.m. got yesterday's date.
- **Customers** stay view-only, with the CSV download.

### Removed from the screens (data kept)
- Per-order "profit" panel (it could not link costs, so it always showed the full price as profit).
- Packaging bag cost setting (it was never counted in the monthly figures).
- "Delivered" switch (money is now dated by payment, so delivery no longer matters for the numbers).
- "Create a new account" button.
