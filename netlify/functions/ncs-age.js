exports.handler = async function (event) {
  const { month, day, year, seasonId } = event.queryStringParameters || {};

  if (!month || !day || !year || !seasonId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };
  }

  try {
    const url = `https://playncs.com/fastpitch/Rules/AgeCalculator?seasonId=${seasonId}&month=${month}&day=${day}&year=${year}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = await res.text();

    // Parse "Age Division:\n\n10U" out of the HTML
    const match =
      html.match(/Age Division:\s*<\/[^>]+>\s*([0-9]+U)/i) ||
      html.match(/Age Division:[^a-zA-Z0-9]*([0-9]+U)/i);

    const division = match ? match[1].trim() : null;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ division }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
