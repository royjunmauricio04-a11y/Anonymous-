# Anonymous

This version adds a real account layer while keeping anonymous sending behavior.

## Sending behavior

### Public anonymous post from the main app
- The sender must be signed in to an account.
- The sender can type any name or nickname in **Name or nickname**.
- The post appears in **Browse**.
- The named person does **not** receive it in their Inbox.
- The sender's username/email is not displayed on the post.

### Private anonymous message through a personal link
- The recipient must have an account and a username.
- The sender must be signed in, but their identity stays hidden from the recipient.
- The personal link identifies the recipient on the server.
- The message is stored as `delivery_type = direct` and linked internally to the recipient's Supabase Auth user.
- RLS allows only that recipient to read the direct message.

A direct link that does not belong to a registered account is rejected.

## Supabase setup

For an existing project, run these in this order:

1. `schema.sql` is for a fresh database only.
2. For the current database, run `account-delivery-migration.sql`.
3. Run the updated `bot.sql` if you use the Maintenance Center / posting bot.
4. In Supabase Authentication, enable the Email provider.
5. Create an account in the site, choose a username, and copy the personal link from Inbox.

If email confirmation is enabled in Supabase, confirm the signup email before signing in.

## Test flow

1. Account A: create username `alice`.
2. Copy Alice's personal link.
3. Account B: sign in as `bob`, open Alice's personal link, send a message. It should appear only in Alice's Inbox.
4. As Bob, go back to the main app and send a message with `Kaye` in the name field. It should appear in Browse and should not arrive in Kaye's Inbox.
5. Try a direct link for a username that does not exist. The message should not be saved.

## Security notes

- The browser never receives `recipient_auth_id` from normal REST queries.
- Direct messages are protected with Supabase Row Level Security.
- Client-side code never uses the Supabase service-role key.
- The sender remains visually anonymous, while account authentication is used to control posting and private Inbox access.
