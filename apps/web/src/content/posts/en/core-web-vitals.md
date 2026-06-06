---
locale: en
key: core-web-vitals
topics: [performance, seo]
category: web
image: /images/posts/core-web-vitals-cover.jpg
cardImage: /images/posts/core-web-vitals-card.jpg
imageAlt: "Web performance dashboard"
slug: core-web-vitals-guide
title: "Core Web Vitals: what they are and how to pass them"
description: "Largest Contentful Paint, Interaction to Next Paint and Cumulative Layout Shift, explained in plain terms with fixes you can ship."
pubDate: 2026-05-20
---

When visitors land on your website, they do not think about code. They notice when a main image takes five seconds to load, when a button clicks but nothing happens, or when the text jumps just as they try to read it. Google measures these exact frustrations through Core Web Vitals. If your website fails these tests, your search engine rankings and your conversion rates suffer. Improving these metrics is not about chasing a perfect score for pride. It is about keeping potential customers on your page instead of losing them to a faster competitor.

Core Web Vitals consist of three specific metrics that measure speed, responsiveness, and visual stability. Here is what they mean for your business and how your development team can fix them.

## Largest Contentful Paint (LCP)

Largest Contentful Paint measures loading performance. Specifically, it tracks how long it takes for the largest visual element on the screen to render. This element is usually a hero image, a background video, or a large block of heading text. To provide a good user experience, your site should hit an LCP of 2.5 seconds or less.

When your LCP is slow, visitors stare at a blank or half-empty screen. You can improve this metric with a few direct technical adjustments:

*   **Compress your images.** Use modern formats like WebP or AVIF instead of heavy PNGs or JPEGs.
*   **Prioritize critical assets.** Tell the browser to load your hero image first by adding a fetchpriority="high" attribute to the image tag.
*   **Eliminate render-blocking resources.** Postpone loading non-essential CSS or JavaScript files that prevent the page from displaying its main content immediately.
*   **Utilize a Content Delivery Network (CDN).** Store copies of your site's assets on servers closer to your visitors to reduce physical data travel time.

## Interaction to Next Paint (INP)

Interaction to Next Paint measures how quickly your website responds when a user interacts with it. This metric replaced First Input Delay (FID) to capture the overall responsiveness of a page throughout a visitor's entire stay. When a user clicks a menu, taps a button, or types in a form, the browser must update the screen in 200 milliseconds or less to feel responsive.

If your INP is high, the site feels sluggish or frozen. This usually happens because the browser's main thread is busy running heavy JavaScript. To fix this:

*   **Break up long tasks.** If a script takes longer than 50 milliseconds to run, rewrite it to execute in smaller chunks. This allows the browser to pause and handle user clicks.
*   **Audit third-party scripts.** Heavy chat widgets, analytics tools, and tracking pixels can block user input. Remove scripts you no longer use and delay the rest until the main page loads.
*   **Optimize your event listeners.** Ensure that the code triggered by a user click runs efficiently without triggering complex page recalculations.

## Cumulative Layout Shift (CLS)

Cumulative Layout Shift measures visual stability. It calculates how much the elements on your page move around while the page is still loading. A good CLS score is 0.1 or less. You have likely experienced bad CLS when you tried to click a link, but a sudden layout shift caused you to click an ad instead.

This issue occurs when the browser does not know how much space to reserve for elements before they load. You can resolve this with clean layout practices:

*   **Set explicit dimensions.** Always include width and height attributes on your image and video tags in your HTML.
*   **Reserve space for dynamic content.** If you load ads, banners, or newsletter sign-up boxes dynamically, use CSS to reserve a container of the correct size beforehand.
*   **Avoid inserting content above existing text.** Do not push content down unless it is in direct response to a user action, like opening an accordion menu.
*   **Control font loading.** Use the CSS property font-display: swap to ensure text remains visible and stable while custom fonts download.

## How to Audit and Prioritize Your Fixes

You do not need to guess where your website stands. Google provides free tools to measure these metrics. Google Search Console has a dedicated Core Web Vitals report that flags pages with poor scores based on real-world user data. For a quick diagnostic test of a single page, you can run a PageSpeed Insights report.

When planning your fixes, always prioritize your mobile scores first. Google uses mobile-first indexing, meaning your mobile performance dictates your search engine rankings. Focus your efforts on high-traffic templates, such as your homepage, main service pages, and checkout funnel. Fixing a template once will improve the scores across dozens of individual pages.

## Real Performance Requires Real Work

Passing Core Web Vitals is not a matter of installing a quick plugin or checking a box in your website builder. It requires clean code, organized assets, and deliberate development choices. When your website loads instantly and responds immediately, you remove the friction that prevents visitors from becoming customers.

If you want a clear assessment of your website's performance and a practical plan to improve your search engine rankings, write to Bezenti. We will analyze your speed bottlenecks and implement the precise technical fixes your business needs.
