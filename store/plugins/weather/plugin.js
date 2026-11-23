/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const CODES = { 0: "☀️ Clear", 1: "🌤️ Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast", 45: "🌫️ Fog", 48: "🌫️ Icy fog",
    51: "🌦️ Light drizzle", 53: "🌦️ Drizzle", 55: "🌧️ Heavy drizzle", 61: "🌧️ Light rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain",
    66: "🌧️ Freezing rain", 67: "🌧️ Freezing rain", 71: "🌨️ Light snow", 73: "🌨️ Snow", 75: "❄️ Heavy snow", 77: "🌨️ Snow grains",
    80: "🌦️ Showers", 81: "🌧️ Showers", 82: "⛈️ Violent showers", 85: "🌨️ Snow showers", 86: "❄️ Heavy snow showers",
    95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm, hail", 99: "⛈️ Thunderstorm, hail" };

meph.commands.register({
    name: "weather",
    description: "Current weather for a city",
    options: [{ name: "city", description: "City name", type: "string", required: true }],
}, async ({ city }) => {
    const { units } = await meph.settings.get();
    const geo = await meph.net.json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const p = geo.results?.[0];
    if (!p) return { reply: `Couldn't find a place called "${city}".` };
    const imp = units === "imperial";
    const w = await meph.net.json(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}`
        + "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
        + (imp ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : ""));
    const c = w.current, t = imp ? "°F" : "°C", v = imp ? "mph" : "km/h";
    return { reply: `**${p.name}${p.admin1 ? ", " + p.admin1 : ""}, ${p.country_code}**: ${CODES[c.weather_code] ?? "?"}, `
        + `${Math.round(c.temperature_2m)}${t} (feels ${Math.round(c.apparent_temperature)}${t}), wind ${Math.round(c.wind_speed_10m)} ${v}, humidity ${c.relative_humidity_2m}%` };
});
