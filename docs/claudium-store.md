# WOC Store and Claudium packs

The WOC Store reads cosmetic availability, Claudium costs, balances, and purchase results from
the economy service. The game client does not invent catalog entries or prices.

## Recommended USD packs

The previous ladder extended to USD 5,000 and USD 10,000. Those packs are not appropriate for a
consumer game store. The recommended replacement follows the familiar premium-currency range
used by established game storefronts while keeping the one Claudium equals USD 0.01 display peg.

| Pack key | USD price | Claudium credited | Bonus over peg |
|---|---:|---:|---:|
| `claudium_500` | $4.99 | 500 | 1 |
| `claudium_1050` | $9.99 | 1,050 | 51 |
| `claudium_2200` | $19.99 | 2,200 | 201 |
| `claudium_4000` | $34.99 | 4,000 | 501 |
| `claudium_6000` | $49.99 | 6,000 | 1,001 |
| `claudium_13000` | $99.99 | 13,000 | 3,001 |

The economy service should expose only these six SKU rows. Remove the old high-value rows rather
than hiding them in the client.

## Stripe configuration

Create one Stripe Price for each USD pack and configure the corresponding economy-service
variables. Suggested names are:

```text
STRIPE_PRICE_CLAUDIUM_500
STRIPE_PRICE_CLAUDIUM_1050
STRIPE_PRICE_CLAUDIUM_2200
STRIPE_PRICE_CLAUDIUM_4000
STRIPE_PRICE_CLAUDIUM_6000
STRIPE_PRICE_CLAUDIUM_13000
```

These names match the economy service implementation. Do not place Stripe secret keys or Price
IDs in the game-client repository.

SOL and WOC amounts must continue to be quoted by the economy service from the USD value. The WOC
rail should return the existing service-computed 20 percent discount. The game client displays
the returned quote and does not calculate token prices or discounts.

## Weapon cosmetic identifiers

The first store catalog supports these service item IDs:

```text
emberfang_sword
redskull_sword
redskull_dagger
redskull_staff
redskull_wand
redskull_hammer
purple_sword
purple_dagger
purple_axe
purple_staff
purple_wand
```

Each row should use `kind: "item"` and a positive integer `costClaudium`. Unknown items and the
old placeholder cosmetics are deliberately omitted from the weapon storefront.

The launch collection prices every weapon cosmetic at 500 Claudium. The client asset registry
also assigns each product to a store category. The initial category is `weapons`; future catalog
updates can add `outfits` and `mounts` without changing the purchase flow.
