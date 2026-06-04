module lofi::lofi;

use sui::coin_registry::{Self, Currency};
use sui::coin;

const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000_000;

public struct LOFI has drop{}

fun init(otw: LOFI, ctx: &mut TxContext){
    let (mut builder, mut treasury_cap) = coin_registry::new_currency_with_otw(
        otw, 
        9, 
        b"LOFI".to_string(),
        b"Lofi Coin".to_string(), 
        b"Create Lofi Coin".to_string(),
        b"https://i.ibb.co/7J6HbMgw/19023983-431a-4013-9333-22ee8ff92c48.jpg".to_string(), 
        ctx
    );


    let total_supply = coin::mint(&mut treasury_cap, TOTAL_SUPPLY, ctx);

    coin_registry::make_supply_fixed_init(&mut builder, treasury_cap);

    let metadata_cap = coin_registry::finalize(builder, ctx);

    transfer::public_transfer(total_supply, ctx.sender());
    transfer::public_transfer(metadata_cap, ctx.sender());
}

public fun get_total_supply(currency: &Currency<LOFI>) : Option<u64>{
    coin_registry::total_supply(currency)
}

public fun is_supply_fix(currency: &Currency<LOFI>) : bool{
    currency.is_supply_fixed()
}