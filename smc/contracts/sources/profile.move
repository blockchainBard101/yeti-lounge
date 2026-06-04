module contracts::profile;

use std::string::String;
use sui::event;
use sui::table::{Self, Table};
use sui::clock::{Self, Clock};

// --- Errors ---
const EProfileAlreadyExists: u64 = 0;
const ENotOwner: u64 = 1;
const EDoubleCheckIn: u64 = 2;

// --- Objects ---

/// Shared registry tracking users and their resolved Yeti profiles.
public struct YetiRegistry has key {
    id: UID,
    profiles: Table<address, address>, // user address -> YetiProfile object ID
    total_yetis: u64,
}

/// On-chain user profile containing avatar images and descriptions.
public struct YetiProfile has key, store {
    id: UID,
    owner: address,
    suins_handle: String,
    avatar_blob_id: String,
    bio: String,
    flurries_balance: u64,
    verified: bool,
    last_check_in: u64,
    streak_count: u64,
}

/// Capability representing admin rights (e.g. setup configurations).
public struct AdminCap has key, store {
    id: UID,
}

// --- Events ---

public struct ProfileCreated has copy, drop {
    profile_id: address,
    owner: address,
    suins_handle: String,
    avatar_blob_id: String,
    bio: String,
}

public struct AvatarUpdated has copy, drop {
    profile_id: address,
    owner: address,
    new_blob_id: String,
}

public struct ProfileUpdated has copy, drop {
    profile_id: address,
    owner: address,
    new_avatar_blob_id: String,
    new_bio: String,
}

public struct HandleUpdated has copy, drop {
    profile_id: address,
    owner: address,
    new_handle: String,
}

public struct ProfileVerified has copy, drop {
    profile_id: address,
    owner: address,
}

public struct DailyCheckInClaimed has copy, drop {
    profile_id: address,
    owner: address,
    streak_count: u64,
    reward_amount: u64,
}

// --- Constructor ---

fun init(ctx: &mut TxContext) {
    // Instantiate and share global profile registry
    let registry = YetiRegistry {
        id: object::new(ctx),
        profiles: table::new(ctx),
        total_yetis: 0,
    };
    transfer::share_object(registry);

    // Mint and transfer Admin Cap to the deployer
    let admin_cap = AdminCap {
        id: object::new(ctx),
    };
    transfer::public_transfer(admin_cap, tx_context::sender(ctx));
}

#[test_only]
public fun test_init(ctx: &mut TxContext) {
    init(ctx)
}

// --- Entry & Public Functions ---

/// Create a new Yeti Profile on-chain and return the object for composability.
public fun create_profile(
    registry: &mut YetiRegistry,
    suins_handle: String,
    avatar_blob_id: String,
    bio: String,
    ctx: &mut TxContext
): YetiProfile {
    let sender = tx_context::sender(ctx);

    // Ensure user does not already own a profile
    assert!(!table::contains(&registry.profiles, sender), EProfileAlreadyExists);

    // Construct profile object
    let profile_id = object::new(ctx);
    let profile_address = object::uid_to_address(&profile_id);

    let profile = YetiProfile {
        id: profile_id,
        owner: sender,
        suins_handle,
        avatar_blob_id,
        bio,
        flurries_balance: 100, // Initial welcome reward
        verified: false,
        last_check_in: 0,
        streak_count: 0,
    };

    // Add mapping and increment count
    table::add(&mut registry.profiles, sender, profile_address);
    registry.total_yetis = registry.total_yetis + 1;

    // Emit creation event
    event::emit(ProfileCreated {
        profile_id: profile_address,
        owner: sender,
        suins_handle,
        avatar_blob_id,
        bio,
    });

    profile
}

/// Entry point wrapping create_profile, executing on-chain transfer to the sender.
entry fun create_profile_entry(
    registry: &mut YetiRegistry,
    suins_handle: String,
    avatar_blob_id: String,
    bio: String,
    ctx: &mut TxContext
) {
    let profile = create_profile(registry, suins_handle, avatar_blob_id, bio, ctx);
    transfer::transfer(profile, tx_context::sender(ctx));
}

/// Update the avatar media blob reference (Walrus BlobID).
public fun update_avatar(
    profile: &mut YetiProfile,
    new_blob_id: String,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(profile.owner == sender, ENotOwner);

    profile.avatar_blob_id = new_blob_id;

    event::emit(AvatarUpdated {
        profile_id: object::uid_to_address(&profile.id),
        owner: sender,
        new_blob_id,
    });
}

/// Entry point wrapping update_avatar.
entry fun update_avatar_entry(
    profile: &mut YetiProfile,
    new_blob_id: String,
    ctx: &mut TxContext
) {
    update_avatar(profile, new_blob_id, ctx);
}

/// Update bio on-chain.
public fun update_bio(
    profile: &mut YetiProfile,
    new_bio: String,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(profile.owner == sender, ENotOwner);

    profile.bio = new_bio;

    event::emit(ProfileUpdated {
        profile_id: object::uid_to_address(&profile.id),
        owner: sender,
        new_avatar_blob_id: profile.avatar_blob_id,
        new_bio,
    });
}

entry fun update_bio_entry(
    profile: &mut YetiProfile,
    new_bio: String,
    ctx: &mut TxContext
) {
    update_bio(profile, new_bio, ctx);
}

/// Update both avatar and bio on-chain.
public fun update_profile(
    profile: &mut YetiProfile,
    new_avatar_blob_id: String,
    new_bio: String,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(profile.owner == sender, ENotOwner);

    profile.avatar_blob_id = new_avatar_blob_id;
    profile.bio = new_bio;

    event::emit(ProfileUpdated {
        profile_id: object::uid_to_address(&profile.id),
        owner: sender,
        new_avatar_blob_id,
        new_bio,
    });
}

entry fun update_profile_entry(
    profile: &mut YetiProfile,
    new_avatar_blob_id: String,
    new_bio: String,
    ctx: &mut TxContext
) {
    update_profile(profile, new_avatar_blob_id, new_bio, ctx);
}

/// Update profile display name handle on-chain.
public fun update_handle(
    profile: &mut YetiProfile,
    new_handle: String,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(profile.owner == sender, ENotOwner);

    profile.suins_handle = new_handle;

    event::emit(HandleUpdated {
        profile_id: object::uid_to_address(&profile.id),
        owner: sender,
        new_handle,
    });
}

entry fun update_handle_entry(
    profile: &mut YetiProfile,
    new_handle: String,
    ctx: &mut TxContext
) {
    update_handle(profile, new_handle, ctx);
}

// --- Getters ---

public fun owner(profile: &YetiProfile): address {
    profile.owner
}

public fun suins_handle(profile: &YetiProfile): String {
    profile.suins_handle
}

public fun avatar_blob_id(profile: &YetiProfile): String {
    profile.avatar_blob_id
}

public fun bio(profile: &YetiProfile): String {
    profile.bio
}

public fun flurries_balance(profile: &YetiProfile): u64 {
    profile.flurries_balance
}

public(package) fun add_flurries(profile: &mut YetiProfile, amount: u64) {
    profile.flurries_balance = profile.flurries_balance + amount;
}

public fun verify_profile(
    profile: &mut YetiProfile,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(profile.owner == sender, ENotOwner);
    profile.verified = true;

    event::emit(ProfileVerified {
        profile_id: object::uid_to_address(&profile.id),
        owner: sender,
    });
}

entry fun verify_profile_entry(
    profile: &mut YetiProfile,
    ctx: &mut TxContext
) {
    verify_profile(profile, ctx);
}

public fun verified(profile: &YetiProfile): bool {
    profile.verified
}

public fun last_check_in(profile: &YetiProfile): u64 {
    profile.last_check_in
}

public fun streak_count(profile: &YetiProfile): u64 {
    profile.streak_count
}

public fun claim_daily_check_in(
    profile: &mut YetiProfile,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(profile.owner == sender, ENotOwner);

    let now_ms = clock::timestamp_ms(clock);
    let last_check = profile.last_check_in;

    if (last_check != 0) {
        assert!(now_ms >= last_check + 86400000, EDoubleCheckIn);
    };

    if (last_check != 0 && now_ms <= last_check + 172800000) {
        profile.streak_count = profile.streak_count + 1;
    } else {
        profile.streak_count = 1;
    };

    profile.last_check_in = now_ms;

    let reward = 10 + (profile.streak_count * 5);
    let final_reward = if (reward > 100) { 100 } else { reward };

    profile.flurries_balance = profile.flurries_balance + final_reward;

    event::emit(DailyCheckInClaimed {
        profile_id: object::uid_to_address(&profile.id),
        owner: sender,
        streak_count: profile.streak_count,
        reward_amount: final_reward,
    });
}

entry fun claim_daily_check_in_entry(
    profile: &mut YetiProfile,
    clock: &Clock,
    ctx: &mut TxContext
) {
    claim_daily_check_in(profile, clock, ctx);
}
