#[test_only]
module contracts::rewards_tests;

use sui::test_scenario;
use contracts::rewards::{Self, QuestRegistry, Quest};
use contracts::profile::{Self, YetiRegistry, YetiProfile, AdminCap};

const ADMIN: address = @0xA;
const USER: address = @0xB;

#[test]
fun test_complete_quest() {
    let mut scenario = test_scenario::begin(ADMIN);

    // Initialize Profile module
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        profile::test_init(test_scenario::ctx(&mut scenario));
    };

    // Initialize Rewards module
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        rewards::test_init(test_scenario::ctx(&mut scenario));
    };

    // Create a Quest
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let mut quest_reg = test_scenario::take_shared<QuestRegistry>(&scenario);

        rewards::add_quest(
            &admin_cap,
            &mut quest_reg,
            b"Move Academy".to_string(),
            b"Complete 5 Move lessons".to_string(),
            50, // reward 50 flurries
            test_scenario::ctx(&mut scenario)
        );

        test_scenario::return_shared(quest_reg);
        test_scenario::return_to_sender(&scenario, admin_cap);
    };

    // Create a Profile for USER
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut registry = test_scenario::take_shared<YetiRegistry>(&scenario);
        profile::create_profile_entry(
            &mut registry,
            b"learner".to_string(),
            b"blob123".to_string(),
            b"learning move".to_string(),
            test_scenario::ctx(&mut scenario)
        );
        test_scenario::return_shared(registry);
    };

    // Admin completes quest for USER
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        let admin_cap = test_scenario::take_from_sender<AdminCap>(&scenario);
        let quest = test_scenario::take_shared<Quest>(&scenario);
        
        // Take the USER's profile from the shared registry? No, YetiProfile is a personal object!
        // We have to simulate the user passing their YetiProfile to the Admin, 
        // or Admin calls it in a PTB where the user provides the Profile.
        // Let's just use test_scenario::take_from_address to get the User's profile.
        let mut user_profile = test_scenario::take_from_address<YetiProfile>(&scenario, USER);

        // Check initial balance (100)
        assert!(profile::flurries_balance(&user_profile) == 100, 0);

        rewards::complete_quest_entry(
            &admin_cap,
            &quest,
            &mut user_profile,
            test_scenario::ctx(&mut scenario)
        );

        // Check new balance (100 + 50 = 150)
        assert!(profile::flurries_balance(&user_profile) == 150, 1);

        test_scenario::return_shared(quest);
        test_scenario::return_to_sender(&scenario, admin_cap);
        test_scenario::return_to_address(USER, user_profile);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_profile_verification() {
    let mut scenario = test_scenario::begin(ADMIN);

    // Initialize Profile module
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        profile::test_init(test_scenario::ctx(&mut scenario));
    };

    // Create a Profile for USER
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut registry = test_scenario::take_shared<YetiRegistry>(&scenario);
        profile::create_profile_entry(
            &mut registry,
            b"learner".to_string(),
            b"blob123".to_string(),
            b"learning move".to_string(),
            test_scenario::ctx(&mut scenario)
        );
        test_scenario::return_shared(registry);
    };

    // Verify profile for USER
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut user_profile = test_scenario::take_from_sender<YetiProfile>(&scenario);

        // Check initially not verified
        assert!(!profile::verified(&user_profile), 0);

        // Call verify_profile_entry
        profile::verify_profile_entry(
            &mut user_profile,
            test_scenario::ctx(&mut scenario)
        );

        // Check verified is true
        assert!(profile::verified(&user_profile), 1);

        test_scenario::return_to_sender(&scenario, user_profile);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_daily_check_in() {
    use sui::clock;
    let mut scenario = test_scenario::begin(ADMIN);

    // Initialize Profile module
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        profile::test_init(test_scenario::ctx(&mut scenario));
    };

    // Create Clock and increment it so it's not 0
    test_scenario::next_tx(&mut scenario, ADMIN);
    let mut clock = clock::create_for_testing(test_scenario::ctx(&mut scenario));
    clock::increment_for_testing(&mut clock, 1000);

    // Create a Profile for USER
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut registry = test_scenario::take_shared<YetiRegistry>(&scenario);
        profile::create_profile_entry(
            &mut registry,
            b"learner".to_string(),
            b"blob123".to_string(),
            b"learning move".to_string(),
            test_scenario::ctx(&mut scenario)
        );
        test_scenario::return_shared(registry);
    };

    // First check-in at t=1000
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut user_profile = test_scenario::take_from_sender<YetiProfile>(&scenario);

        assert!(profile::streak_count(&user_profile) == 0, 0);
        assert!(profile::last_check_in(&user_profile) == 0, 1);

        profile::claim_daily_check_in(
            &mut user_profile,
            &clock,
            test_scenario::ctx(&mut scenario)
        );

        // Streak count should be 1, last check-in should be 1000
        assert!(profile::streak_count(&user_profile) == 1, 2);
        assert!(profile::last_check_in(&user_profile) == 1000, 3);
        assert!(profile::flurries_balance(&user_profile) == 115, 4); // 100 + 10 + 1 * 5 = 115

        test_scenario::return_to_sender(&scenario, user_profile);
    };

    // Advance clock by 25 hours (90,000,000 ms) and check in again
    clock::increment_for_testing(&mut clock, 90000000);
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut user_profile = test_scenario::take_from_sender<YetiProfile>(&scenario);

        profile::claim_daily_check_in(
            &mut user_profile,
            &clock,
            test_scenario::ctx(&mut scenario)
        );

        // Streak should increment to 2, last check-in should be 90,001,000
        assert!(profile::streak_count(&user_profile) == 2, 5);
        assert!(profile::last_check_in(&user_profile) == 90001000, 6);
        assert!(profile::flurries_balance(&user_profile) == 135, 7); // 115 + 10 + 2 * 5 = 135

        test_scenario::return_to_sender(&scenario, user_profile);
    };

    clock::destroy_for_testing(clock);
    test_scenario::end(scenario);
}

#[test]
fun test_glacier_donations() {
    use contracts::glacier::{Self, GlacierFund};
    use sui::coin;

    let mut scenario = test_scenario::begin(ADMIN);

    // Create a GlacierFund for sui::sui::SUI (generic type parameter)
    test_scenario::next_tx(&mut scenario, ADMIN);
    {
        glacier::create_fund<sui::sui::SUI>(test_scenario::ctx(&mut scenario));
    };

    // User donates 500 SUI
    test_scenario::next_tx(&mut scenario, USER);
    {
        let mut fund = test_scenario::take_shared<GlacierFund<sui::sui::SUI>>(&scenario);
        
        let coin = coin::mint_for_testing<sui::sui::SUI>(500, test_scenario::ctx(&mut scenario));
        
        assert!(glacier::total_donated(&fund) == 0, 0);
        assert!(glacier::balance_value(&fund) == 0, 1);

        glacier::donate(&mut fund, coin, test_scenario::ctx(&mut scenario));

        assert!(glacier::total_donated(&fund) == 500, 2);
        assert!(glacier::balance_value(&fund) == 500, 3);

        test_scenario::return_shared(fund);
    };

    test_scenario::end(scenario);
}
