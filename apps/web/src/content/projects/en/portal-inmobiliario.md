---
locale: en
key: portal-inmobiliario
topics: [seo, performance]
category: web
image: /images/projects/portal-inmobiliario-cover.jpg
cardImage: /images/projects/portal-inmobiliario-card.jpg
imageAlt: "Real Estate Portal"
slug: real-estate-portal
title: "Real Estate Portal"
description: "A real estate platform with property listings, advanced filters, image galleries and a contact form."
client: "Inmobiliaria AWM"
year: 2026
featured: false
services: [web-design, web-custom, seo]
# ⚠️ EXAMPLE METRICS — replace with the client's real data.
results:
  - { value: "×2", label: "leads per property" }
  - { value: "+120", label: "properties listed" }
  - { value: "0.4 s", label: "filter response" }
url: https://inmobiliaria-awm.pages.dev
---

Inmobiliaria AWM sells and rents property, and needed to leave behind PDF listings and WhatsApp groups. We built them their own portal where every property has its page, its photos and its form, and where visitors find what they want without calling anyone.

## The challenge

The catalogue changed every week and there was no quick way to publish it. The agent uploaded photos over chat, enquiries arrived scattered and got lost, and no one knew which property was drawing interest. They needed a site to publish fast, filter well and capture each contact with its context.

## What we did

Full design and build of a custom portal:

- Property listings with individual pages: price, area, bedrooms, location and status.
- Advanced filters by type, area, price range and number of rooms.
- An image gallery per property with optimized loading.
- A contact form on each page that arrives tagged with the property reference.
- A panel to publish and edit properties without touching code.
- Technical SEO per page so each property ranks on its own.

## How we built it

The bottleneck in a portal is filtering: if every filter change reloads the page, users leave. We solved filtering on the client over already-loaded data, so the list responds instantly with no round trip to the server. Images are served in modern formats and lazy-loaded to protect LCP on mobile, which is where most browsing happens.

For SEO, each property page has its own URL, title and structured data, so Google indexes individual properties and not just the homepage. The site meets contrast and keyboard-navigation standards (AA), and the form arrives labelled with the source property so no enquiry loses its context.

## Results

Publishing stopped being a chore, and enquiries started arriving organized, already tied to a specific property. With filters responding almost instantly, visitors browse more listings and leave more contacts per property.
