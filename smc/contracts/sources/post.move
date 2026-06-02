module contracts::post;

use std::string::String;
use sui::clock::{Self, Clock};
use sui::event;
use sui::vec_set::{Self, VecSet};
use contracts::profile::YetiProfile;

// --- Structures ---

/// Represents a comment on a meme post
public struct Comment has store, copy, drop {
    author: address,
    text_content: String,
    created_at: u64,
}

/// On-chain shared MemePost object
public struct MemePost has key {
    id: UID,
    author: address,
    text_content: String,
    media_blob_id: String,
    yerrs_count: u64,
    upvotes: u64,
    downvotes: u64,
    likes: u64,
    comments: vector<Comment>,
    upvoters: VecSet<address>,
    downvoters: VecSet<address>,
}

// --- Events ---

public struct PostCreated has copy, drop {
    post_id: address,
    author: address,
    text_content: String,
    media_blob_id: String,
}

public struct CommentAdded has copy, drop {
    post_id: address,
    author: address,
    text_content: String,
    created_at: u64,
}

public struct PostYerrd has copy, drop {
    post_id: address,
    yerrer: address,
    total_yerrs: u64,
}

public struct PostLiked has copy, drop {
    post_id: address,
    liker: address,
    total_likes: u64,
}

public struct PostUpvoted has copy, drop {
    post_id: address,
    voter: address,
    total_upvotes: u64,
}

public struct PostDownvoted has copy, drop {
    post_id: address,
    voter: address,
    total_downvotes: u64,
}

// --- Entry & Public Functions ---

/// Create a new MemePost object and return it for composability.
public fun create_post(
    profile: &YetiProfile,
    text_content: String,
    media_blob_id: String,
    ctx: &mut TxContext
): MemePost {
    let sender = tx_context::sender(ctx);
    // Ensure the sender owns the profile they claim to post with (using method syntax)
    assert!(profile.owner() == sender, 1);

    let post_id = object::new(ctx);
    let post_address = object::uid_to_address(&post_id);

    let post = MemePost {
        id: post_id,
        author: sender,
        text_content,
        media_blob_id,
        yerrs_count: 0,
        upvotes: 0,
        downvotes: 0,
        likes: 0,
        comments: vector::empty<Comment>(),
        upvoters: vec_set::empty<address>(),
        downvoters: vec_set::empty<address>(),
    };

    // Emit creation event
    event::emit(PostCreated {
        post_id: post_address,
        author: sender,
        text_content,
        media_blob_id,
    });

    post
}

/// Entry point wrapping create_post, executing on-chain share.
entry fun create_post_entry(
    profile: &YetiProfile,
    text_content: String,
    media_blob_id: String,
    ctx: &mut TxContext
) {
    let post = create_post(profile, text_content, media_blob_id, ctx);
    transfer::share_object(post);
}

/// Reaction interaction — "YERRRR" a post.
public fun yerr_post(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    post.yerrs_count = post.yerrs_count + 1;

    event::emit(PostYerrd {
        post_id: object::uid_to_address(&post.id),
        yerrer: sender,
        total_yerrs: post.yerrs_count,
    });
}

/// Entry point wrapping yerr_post.
entry fun yerr_post_entry(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    yerr_post(post, ctx);
}

/// Reaction interaction — "Like" a post.
public fun like_post(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    post.likes = post.likes + 1;

    event::emit(PostLiked {
        post_id: object::uid_to_address(&post.id),
        liker: sender,
        total_likes: post.likes,
    });
}

entry fun like_post_entry(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    like_post(post, ctx);
}

/// Reaction interaction — "Upvote" a post.
public fun upvote_post(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    
    if (vec_set::contains(&post.upvoters, &sender)) {
        vec_set::remove(&mut post.upvoters, &sender);
    } else {
        if (vec_set::contains(&post.downvoters, &sender)) {
            vec_set::remove(&mut post.downvoters, &sender);
        };
        vec_set::insert(&mut post.upvoters, sender);
    };

    post.upvotes = (vec_set::length(&post.upvoters) as u64);
    post.downvotes = (vec_set::length(&post.downvoters) as u64);

    event::emit(PostUpvoted {
        post_id: object::uid_to_address(&post.id),
        voter: sender,
        total_upvotes: post.upvotes,
    });
}

entry fun upvote_post_entry(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    upvote_post(post, ctx);
}

/// Reaction interaction — "Downvote" a post.
public fun downvote_post(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);

    if (vec_set::contains(&post.downvoters, &sender)) {
        vec_set::remove(&mut post.downvoters, &sender);
    } else {
        if (vec_set::contains(&post.upvoters, &sender)) {
            vec_set::remove(&mut post.upvoters, &sender);
        };
        vec_set::insert(&mut post.downvoters, sender);
    };

    post.upvotes = (vec_set::length(&post.upvoters) as u64);
    post.downvotes = (vec_set::length(&post.downvoters) as u64);

    event::emit(PostDownvoted {
        post_id: object::uid_to_address(&post.id),
        voter: sender,
        total_downvotes: post.downvotes,
    });
}

entry fun downvote_post_entry(
    post: &mut MemePost,
    ctx: &mut TxContext
) {
    downvote_post(post, ctx);
}

/// Add a comment to an existing MemePost.
public fun add_comment(
    post: &mut MemePost,
    text_content: String,
    clock: &Clock,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    let timestamp = clock::timestamp_ms(clock);

    let comment = Comment {
        author: sender,
        text_content,
        created_at: timestamp,
    };

    vector::push_back(&mut post.comments, comment);

    event::emit(CommentAdded {
        post_id: object::uid_to_address(&post.id),
        author: sender,
        text_content,
        created_at: timestamp,
    });
}

/// Entry point wrapping add_comment.
entry fun add_comment_entry(
    post: &mut MemePost,
    text_content: String,
    clock: &Clock,
    ctx: &mut TxContext
) {
    add_comment(post, text_content, clock, ctx);
}

// --- Getters ---

public fun author(post: &MemePost): address {
    post.author
}

public fun text_content(post: &MemePost): String {
    post.text_content
}

public fun media_blob_id(post: &MemePost): String {
    post.media_blob_id
}

public fun yerrs_count(post: &MemePost): u64 {
    post.yerrs_count
}

public fun upvotes(post: &MemePost): u64 {
    post.upvotes
}

public fun downvotes(post: &MemePost): u64 {
    post.downvotes
}

public fun likes(post: &MemePost): u64 {
    post.likes
}

public fun comments(post: &MemePost): &vector<Comment> {
    &post.comments
}
