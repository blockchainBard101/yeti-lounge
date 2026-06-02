module contracts::rewards;

use std::string::String;
use sui::event;
use contracts::profile::{Self, YetiProfile, AdminCap};

// --- Objects ---

/// Quest details for users to complete
public struct Quest has key, store {
    id: UID,
    title: String,
    description: String,
    reward_amount: u64,
}

/// A registry containing the active quests in the system
public struct QuestRegistry has key {
    id: UID,
    total_quests: u64,
}

// --- Events ---

public struct QuestAdded has copy, drop {
    quest_id: ID,
    title: String,
    reward_amount: u64,
}

public struct QuestCompleted has copy, drop {
    profile_owner: address,
    quest_title: String,
    reward_amount: u64,
}

// --- Constructor ---

fun init(ctx: &mut TxContext) {
    let registry = QuestRegistry {
        id: object::new(ctx),
        total_quests: 0,
    };
    transfer::share_object(registry);
}

#[test_only]
public fun test_init(ctx: &mut TxContext) {
    init(ctx)
}

// --- Admin Functions ---

/// Add a new Quest to the registry. Only Admin can do this.
public fun add_quest(
    _admin: &AdminCap,
    registry: &mut QuestRegistry,
    title: String,
    description: String,
    reward_amount: u64,
    ctx: &mut TxContext
) {
    let quest_id = object::new(ctx);
    let id_val = object::uid_to_inner(&quest_id);

    let quest = Quest {
        id: quest_id,
        title,
        description,
        reward_amount,
    };

    transfer::public_share_object(quest);
    registry.total_quests = registry.total_quests + 1;

    event::emit(QuestAdded {
        quest_id: id_val,
        title,
        reward_amount,
    });
}

/// Marks a quest as complete for a given YetiProfile and awards flurries.
/// This is gated by the AdminCap (intended to be executed by the Sponsor Guardian).
public fun complete_quest(
    _admin: &AdminCap,
    quest: &Quest,
    profile: &mut YetiProfile,
    _ctx: &mut TxContext
) {
    let amount = quest.reward_amount;
    
    // Add flurries to the user's profile
    profile::add_flurries(profile, amount);

    event::emit(QuestCompleted {
        profile_owner: profile::owner(profile),
        quest_title: quest.title,
        reward_amount: amount,
    });
}

entry fun complete_quest_entry(
    admin: &AdminCap,
    quest: &Quest,
    profile: &mut YetiProfile,
    ctx: &mut TxContext
) {
    complete_quest(admin, quest, profile, ctx);
}
