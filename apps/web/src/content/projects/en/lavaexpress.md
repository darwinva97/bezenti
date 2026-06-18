---
locale: en
key: lavaexpress
category: web
image: /images/projects/lavaexpress-cover.jpg
cardImage: /images/projects/lavaexpress-card.jpg
imageAlt: "LavaExpress Laundry"
slug: lavaexpress-laundry
title: "LavaExpress Laundry"
description: "A platform for a laundry service with pricing, a home pickup flow and WhatsApp booking."
client: "LavaExpress"
year: 2026
featured: false
url: https://lavanderia-dfj.pages.dev
topics: [bots, automation]
services: [web-design, bots, automation]
results:
  # ⚠️ EXAMPLE METRICS — replace with the client's real data.
  - { value: "+52%", label: "WhatsApp bookings" }
  - { value: "×3", label: "automated pickups" }
  - { value: "< 2 min", label: "response time" }
---

LavaExpress is a neighborhood laundry with home pickup and delivery. Orders came in by phone and scattered messages, and slots slipped through the cracks. They needed a website that showed clear pricing and let customers book without a phone call.

## The challenge

The business ran on WhatsApp, but everything was manual: a customer asked for a price, someone replied when they could, a time was agreed, and the appointment sometimes got lost. With no clear schedule, pickups clashed and slow replies sent customers to the competition.

## What we did

We designed and built the website and added a WhatsApp bot that keeps bookings in order.

- A pricing page by garment type and service, no fine print.
- A step-by-step home pickup flow: address, time slot and confirmation.
- A WhatsApp bot that answers prices and schedules pickups with no human in the loop.
- Automatic confirmations and reminders before each pickup.
- A simple panel to see the day's bookings and mark deliveries.
- A responsive, mobile-first design, since that's how almost everyone arrives.

## How we built it

A fast static site served from a CDN, loading under a second on mobile. The bot sits on the WhatsApp API and an automation flow that connects the conversation to the schedule: when a customer confirms a slot, the pickup is created and the reminder is triggered. We validated each step so an incomplete message never creates a broken booking. AA accessibility and local SEO so "laundry with home pickup" shows up in their area.

## Results

WhatsApp bookings grew because customers no longer wait for someone to reply: the bot answers instantly, day and night. Pickups got organized into slots and reminders cut no-shows. Response time went from hours to under two minutes.
