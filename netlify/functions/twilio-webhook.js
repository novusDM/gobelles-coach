// netlify/functions/twilio-webhook.js
// Receives inbound SMS from Twilio, saves to Supabase, returns empty TwiML

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse Twilio's URL-encoded POST body
    const params = new URLSearchParams(event.body);
    const from = params.get("From"); // e.g. "+18175551234"
    const body = params.get("Body") || "";
    const sid = params.get("MessageSid");

    if (!from || !body) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/xml" },
        body: `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      };
    }

    // Normalize phone number
    const phone = from.trim();

    // Upsert conversation row (create if new, update last_message fields if existing)
    const { data: convData, error: convError } = await supabase
      .from("sms_conversations")
      .upsert(
        {
          phone,
          last_message_at: new Date().toISOString(),
          last_message_preview: body.substring(0, 80),
          unread_count: supabase.rpc("increment_unread", { phone_arg: phone }),
        },
        { onConflict: "phone", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    // If upsert didn't return id cleanly, fetch it
    let conversationId = convData?.id;
    if (!conversationId) {
      const { data: existing } = await supabase
        .from("sms_conversations")
        .select("id, unread_count")
        .eq("phone", phone)
        .single();

      if (existing) {
        conversationId = existing.id;
        // Manually increment unread
        await supabase
          .from("sms_conversations")
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: body.substring(0, 80),
            unread_count: (existing.unread_count || 0) + 1,
          })
          .eq("phone", phone);
      } else {
        // Brand new conversation with no signup match yet
        const { data: newConv } = await supabase
          .from("sms_conversations")
          .insert({
            phone,
            last_message_at: new Date().toISOString(),
            last_message_preview: body.substring(0, 80),
            unread_count: 1,
          })
          .select("id")
          .single();
        conversationId = newConv?.id;
      }
    }

    if (!conversationId) {
      console.error("Could not resolve conversation ID for", phone);
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/xml" },
        body: `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      };
    }

    // Try to link to tryout_signups if not already linked
    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("signup_id, parent_name, player_name")
      .eq("id", conversationId)
      .single();

    if (!conv?.signup_id) {
      // Look up by phone in tryout_signups (field is parent_phone)
      const { data: signup } = await supabase
        .from("tryout_signups")
        .select("id, parent_name, player_name")
        .eq("parent_phone", phone)
        .single();

      if (signup) {
        await supabase
          .from("sms_conversations")
          .update({
            signup_id: signup.id,
            parent_name: signup.parent_name,
            player_name: signup.player_name,
          })
          .eq("id", conversationId);
      }
    }

    // Insert the inbound message
    await supabase.from("sms_messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      body,
      twilio_sid: sid,
    });

    // Return empty TwiML so Twilio doesn't auto-reply
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/xml" },
      body: `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    };
  } catch (err) {
    console.error("twilio-webhook error:", err);
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/xml" },
      body: `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    };
  }
};
