module contracts::profile;

use std::string::String;
use sui::event;
use sui::table::{Self, Table};

// --- Errors ---
const EProfileAlreadyExists: u64 = 0;
const ENotOwner: u64 = 1;

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
