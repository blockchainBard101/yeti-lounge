module contracts::glacier;

use sui::coin::Coin;
use sui::balance::{Self, Balance};
use sui::event;

// --- Errors ---
const EInvalidAmount: u64 = 0;

// --- Objects ---

/// Shared GlacierFund tracking donations of token type T.
public struct GlacierFund<phantom T> has key {
    id: UID,
    balance: Balance<T>,
    total_donated: u64,
}

// --- Events ---

public struct DonationReceived has copy, drop {
    fund_id: address,
    donor: address,
    amount: u64,
}

// --- Public functions ---

/// Create and share a new GlacierFund for token T.
public fun create_fund<T>(ctx: &mut TxContext) {
    let fund = GlacierFund<T> {
        id: object::new(ctx),
        balance: balance::zero(),
        total_donated: 0,
    };
    transfer::share_object(fund);
}

entry fun create_fund_entry<T>(ctx: &mut TxContext) {
    create_fund<T>(ctx);
}

/// Donate tokens of type T to the fund.
public fun donate<T>(
    fund: &mut GlacierFund<T>,
    coin: Coin<T>,
    ctx: &mut TxContext
) {
    let amount = coin.value();
    assert!(amount > 0, EInvalidAmount);

    let donor = tx_context::sender(ctx);
    balance::join(&mut fund.balance, coin.into_balance());
    fund.total_donated = fund.total_donated + amount;

    event::emit(DonationReceived {
        fund_id: object::uid_to_address(&fund.id),
        donor,
        amount,
    });
}

entry fun donate_entry<T>(
    fund: &mut GlacierFund<T>,
    coin: Coin<T>,
    ctx: &mut TxContext
) {
    donate(fund, coin, ctx);
}

// --- Getters ---

public fun total_donated<T>(fund: &GlacierFund<T>): u64 {
    fund.total_donated
}

public fun balance_value<T>(fund: &GlacierFund<T>): u64 {
    balance::value(&fund.balance)
}
