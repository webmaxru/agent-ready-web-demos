// JSON-LD for Nordlys Cabins, built from the same store data the pages render.
// Rule: nothing goes into the markup that a visitor cannot see on the page.
const SCHEMA = 'https://schema.org';
const abs = (page, path) => new URL(path, page.url).href;
const id = (page, path, frag) => `${abs(page, path)}#${frag}`;

export function organization(page) {
  return {
    '@type': 'Organization',
    '@id': id(page, '/', 'organization'),
    name: 'Nordlys Cabins',
    url: abs(page, '/'),
    logo: abs(page, '/images/favicon.svg'),
  };
}

export function website(page) {
  return { '@type': 'WebSite', '@id': id(page, '/', 'website'), name: 'Nordlys Cabins', url: abs(page, '/'), publisher: { '@id': id(page, '/', 'organization') } };
}

export function rating(reviews) {
  if (!reviews.length) return null;
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return { ratingValue: Math.round(avg * 10) / 10, reviewCount: reviews.length };
}

/** One cabin: a VacationRental that contains one Accommodation. */
export function cabinGraph(page, store, cabin) {
  const features = store.features();
  const reviews = store.reviewsFor(cabin.slug);
  const stars = rating(reviews);
  const rental = {
    '@type': 'VacationRental',
    '@id': id(page, `/cabins/${cabin.slug}`, 'rental'),
    additionalType: 'Cabin',
    identifier: cabin.slug,
    name: cabin.name,
    description: cabin.summary,
    url: abs(page, `/cabins/${cabin.slug}`),
    image: abs(page, cabin.image),
    address: { '@type': 'PostalAddress', addressRegion: cabin.county, addressCountry: 'NO' },
    geo: { '@type': 'GeoCoordinates', latitude: cabin.geo.latitude, longitude: cabin.geo.longitude },
    checkinTime: cabin.checkInTime,
    checkoutTime: cabin.checkOutTime,
    containsPlace: {
      '@type': 'Accommodation',
      additionalType: 'EntirePlace',
      occupancy: { '@type': 'QuantitativeValue', maxValue: cabin.maxGuests },
      numberOfBedrooms: cabin.bedrooms,
      bed: cabin.beds,
      amenityFeature: cabin.features.map((f) => ({ '@type': 'LocationFeatureSpecification', name: features[f] ?? f, value: true })),
    },
    makesOffer: {
      '@type': 'Offer',
      url: abs(page, `/book/${cabin.slug}`),
      priceSpecification: [
        { '@type': 'UnitPriceSpecification', name: 'Sunday to Thursday nights', price: cabin.nightlyRate, priceCurrency: cabin.currency, unitText: 'night' },
        { '@type': 'UnitPriceSpecification', name: 'Friday and Saturday nights', price: cabin.weekendRate, priceCurrency: cabin.currency, unitText: 'night' },
        { '@type': 'PriceSpecification', name: 'Cleaning, bed linen and towels, per stay', price: cabin.cleaningFee, priceCurrency: cabin.currency },
      ],
    },
    potentialAction: {
      '@type': 'ReserveAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${abs(page, `/book/${cabin.slug}`)}?checkIn={checkIn}&checkOut={checkOut}&guests={guests}`,
        actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'],
      },
      result: { '@type': 'LodgingReservation' },
    },
    parentOrganization: { '@id': id(page, '/', 'organization') },
  };
  if (stars) {
    rental.aggregateRating = { '@type': 'AggregateRating', ...stars, bestRating: 5, worstRating: 1 };
    rental.review = reviews.map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.author },
      datePublished: r.date,
      reviewBody: r.text,
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    }));
  }
  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Cabins', item: abs(page, '/cabins') },
      { '@type': 'ListItem', position: 2, name: cabin.name },
    ],
  };
  return { '@context': SCHEMA, '@graph': [rental, crumbs] };
}

export function cabinListGraph(page, cabins) {
  return {
    '@context': SCHEMA,
    '@type': 'ItemList',
    name: 'Nordlys cabins',
    itemListElement: cabins.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(page, `/cabins/${c.slug}`), name: c.name })),
  };
}

export function articleGraph(page, article) {
  const posting = {
    '@type': 'BlogPosting',
    '@id': id(page, `/guide/${article.slug}`, 'article'),
    headline: article.title,
    description: article.description,
    datePublished: article.published,
    dateModified: article.updated ?? article.published,
    url: abs(page, `/guide/${article.slug}`),
    author: { '@id': id(page, '/', 'organization') },
    publisher: { '@id': id(page, '/', 'organization') },
  };
  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Guide', item: abs(page, '/guide') },
      { '@type': 'ListItem', position: 2, name: article.title },
    ],
  };
  return { '@context': SCHEMA, '@graph': [posting, crumbs] };
}

export function faqGraph(page, faq) {
  return {
    '@context': SCHEMA,
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      url: abs(page, `/faq#${f.id}`),
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function homeGraph(page) {
  return { '@context': SCHEMA, '@graph': [organization(page), website(page)] };
}
