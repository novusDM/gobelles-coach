// netlify/functions/send-sms.js
// Called from the coach portal to send an outbound SMS

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
    const { phone, body, coachName, conversationId } = JSON.parse(event.body);

    if (!phone || !body || !coachName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // Send via Twilio REST API
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phone,
          From: fromNumber,
          Body: body,
        }).toString(),
      }
    );

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("Twilio error:", twilioData);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: twilioData.message || "Twilio error" }),
      };
    }

    // Resolve or create conversation
    let convId = conversationId;

    if (!convId) {
      const { data: existing } = await supabase
        .from("sms_conversations")
        .select("id")
        .eq("phone", phone)
        .single();

      if (existing) {
        convId = existing.id;
      } else {
        const { data: newConv } = await supabase
          .from("sms_conversations")
          .insert({
            phone,
            last_message_at: new Date().toISOString(),
            last_message_preview: body.substring(0, 80),
            unread_count: 0,
          })
          .select("id")
          .single();
        convId = newConv?.id;
      }
    }

    // Update conversation last message
    await supabase
      .from("sms_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.substring(0, 80),
      })
      .eq("id", convId);

    // Save outbound message
    await supabase.from("sms_messages").insert({
      conversation_id: convId,
      direction: "outbound",
      body,
      twilio_sid: twilioData.sid,
      sent_by: coachName,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, sid: twilioData.sid, convId }),
    };
  } catch (err) {
    console.error("send-sms error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
