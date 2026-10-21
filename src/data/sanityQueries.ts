import { sanityClient } from '@/lib/sanity'
import { ANNOUNCEMENT_FIELDS, EVENT_FIELDS } from '@/lib/detailItems'

// ── Site Settings ────────────────────────────────────
export async function getSiteSettings() {
  return sanityClient.fetch(`
    *[_type == "siteSettings"][0] {
      name,
      tagline,
      shortDescription,
      heroText,
      displayTitle,
      displayLogo,
      foundedYear,
      ein,
      contact,
      socialMedia,
      locations,
      newsletterHeading,
      newsletterDescription
    }
  `)
}

// ── Prayer Times ─────────────────────────────────────
export async function getPrayerTimesConfig() {
  return sanityClient.fetch(`
    *[_type == "prayerTimes"][0] {
      useAladhanApi,
      calculationMethod,
      location,
      manualOverride,
      jummahDetails,
      notes
    }
  `)
}

// ── Campaign ─────────────────────────────────────────
// "updates" are the dated mosque updates shown only on the Sajjadia Mosque
// page. Photos and videos now come from Albums (see getAlbums below).
export async function getCampaign() {
  return sanityClient.fetch(`
    *[_type == "campaign"][0] {
      title,
      tagline,
      isActive,
      goalAmount,
      raisedAmount,
      lastUpdated,
      donationUrl,
      story,
      milestones,
      callToAction,
      thankYouMessage,
      updates[] {
        _key,
        date,
        title,
        body,
        image
      }
    }
  `)
}

// ── Albums ───────────────────────────────────────────
// Photo and video albums. Category values match the album schema in Sanity:
// "programs", "property", "renderings", "construction".
// Image dimensions and crop come along so the full-screen viewer can size
// each photo before it loads.
export async function getAlbums(categories: string[]) {
  return sanityClient.fetch(
    `
    *[_type == "album" && isPublished != false && category in $categories] | order(date desc) {
      _id,
      title,
      category,
      date,
      description,
      "photos": photos[defined(asset)] {
        _key,
        caption,
        alt,
        crop,
        hotspot,
        asset-> {
          _id,
          metadata { lqip, dimensions { width, height } }
        }
      },
      "videos": videos[defined(url)] {
        _key,
        url,
        title
      }
    }
  `,
    { categories },
  )
}

// ── Giving Options ─────────────────────────────────────
export async function getGivingOptions() {
  return sanityClient.fetch(`
    *[_type == "givingOptions"][0]{
      mosqueDescription, generalTitle, generalDescription, generalDonationUrl,
      khumsDescription, khumsOrgName, khumsValidThrough, khumsUrl,
      khumsGuideImage,
      "ijazaUrl": ijazaPdf.asset->url
    }
  `)
}

// ── Announcements ─────────────────────────────────────
export async function getAnnouncements(limit = 10) {
  return sanityClient.fetch(`
    *[_type == "announcement" && status == "approved" && defined(slug.current)
      && (!defined(expiryDate) || expiryDate > now())]
    | order(isPinned desc, publishDate desc) [0...$limit] { ${ANNOUNCEMENT_FIELDS} }
  `, { limit })
}

// ── Programs ──────────────────────────────────────────
export async function getUpcomingPrograms(limit = 10) {
  return sanityClient.fetch(`
    *[_type == "program" && isPublished == true && defined(slug.current)
      && coalesce(endDate, startDate) > now()]
    | order(startDate asc) [0...$limit] { ${EVENT_FIELDS} }
  `, { limit })
}
export async function getPastPrograms(limit = 20) {
  return sanityClient.fetch(`
    *[_type == "program" && isPublished == true && defined(slug.current)
      && coalesce(endDate, startDate) <= now()]
    | order(startDate desc) [0...$limit] { ${EVENT_FIELDS} }
  `, { limit })
}

// ── FAQ ───────────────────────────────────────────────
/** @public Reserved for the Phase 8 chatbot */
export async function getFAQ() {
  return sanityClient.fetch(`
    *[_type == "faqEntry" && isPublished == true]
    | order(category asc, order asc) {
      _id,
      question,
      answer,
      category,
      order
    }
  `)
}

/** @public Reserved for the Phase 8 chatbot */
export async function getChatbotFAQ() {
  // Only entries flagged for chatbot inclusion
  return sanityClient.fetch(`
    *[_type == "faqEntry"
      && isPublished == true
      && includeInChatbot == true]
    | order(category asc, order asc) {
      question,
      answer,
      category
    }
  `)
}

// ── Org Info (for chatbot context) ───────────────────
export async function getOrgInfo() {
  return sanityClient.fetch(`
    *[_type == "orgInfo"][0] {
      mission,
      vision,
      about,
      currentSituation,
      futurePlans,
      denomination,
      nonprofitStatus,
      chatbotPersonality,
      chatbotBoundaries,
      "resources": resources[isPublic != false && defined(file.asset)] {
        _key,
        label,
        description,
        "url": file.asset->url,
        "size": file.asset->size
      }
    }
  `)
}

// ── Timeline Events (for chatbot context) ───────────────────
export async function getTimelineEvents() {
  return sanityClient.fetch(`
    *[_type == "timelineEvent"]
    | order(date asc) {
      _id,
      title,
      date,
      description,
      category,
      status,
      isFeatured,
      order,
      images[] {
        image,
        caption
      },
      documents[] {
        file {
          asset-> { url }
        },
        label
      }
    }
  `)
}