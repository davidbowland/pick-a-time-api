/* eslint sort-keys:0 */
import {
  ChoiceDetail,
  ChoicesRecord,
  GeocodedAddress,
  NewSessionInput,
  PatchOperation,
  PlaceDetails,
  SessionRecord,
  ShareInput,
  UserRecord,
} from '@types'

// Places

export const placeId = 'ChIJk8cmpsa33IcRbKLpDn3le4g'
export const place1: PlaceDetails = {
  formattedAddress: '115 S 5th St, Columbia, MO 65201, USA',
  formattedPhoneNumber: '(573) 499-0400',
  internationalPhoneNumber: '+1 573-499-0400',
  name: 'Flat Branch Pub & Brewing',
  openHours: [
    'Monday: 11:00 AM – 9:00 PM',
    'Tuesday: 11:00 AM – 10:00 PM',
    'Wednesday: 11:00 AM – 10:00 PM',
    'Thursday: 11:00 AM – 10:00 PM',
    'Friday: 11:00 AM – 10:00 PM',
    'Saturday: 11:00 AM – 10:00 PM',
    'Sunday: 11:00 AM – 9:00 PM',
  ],
  openNow: true,
  openingHoursPeriods: [
    {
      open: { day: 0, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 2 } },
      close: { day: 0, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 2 } },
    },
    {
      open: { day: 1, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 3 } },
      close: { day: 1, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 3 } },
    },
    {
      open: { day: 2, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 4 } },
      close: { day: 2, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 4 } },
    },
    {
      open: { day: 3, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 5 } },
      close: { day: 3, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 5 } },
    },
    {
      open: { day: 4, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 6 } },
      close: { day: 4, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 6 } },
    },
    {
      open: { day: 5, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 7 } },
      close: { day: 5, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 7 } },
    },
    {
      open: { day: 6, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 8 } },
      close: { day: 6, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 8 } },
    },
  ],
  utcOffsetMinutes: undefined,
  photos: ['a-picture-stream', 'a-picture-stream', 'a-picture-stream', 'a-picture-stream', 'a-picture-stream'],
  placeId: 'ChIJ34KrisW33IcRdVRBVG0IFrA',
  priceLevel: 'PRICE_LEVEL_MODERATE',
  rating: 4.5,
  ratingsTotal: undefined,
  placeTypes: ['pub', 'bar', 'american_restaurant', 'restaurant', 'food', 'point_of_interest', 'establishment'],
  website: 'http://www.flatbranch.com/',
}

export const place2: PlaceDetails = {
  formattedAddress: '225 S 9th St, Columbia, MO 65201, USA',
  formattedPhoneNumber: '(573) 449-2454',
  internationalPhoneNumber: '+1 573-449-2454',
  name: "Shakespeare's Pizza - Downtown",
  openHours: [
    'Monday: 11:00 AM – 9:00 PM',
    'Tuesday: 11:00 AM – 9:00 PM',
    'Wednesday: 11:00 AM – 9:00 PM',
    'Thursday: 11:00 AM – 9:00 PM',
    'Friday: 11:00 AM – 10:00 PM',
    'Saturday: 11:00 AM – 10:00 PM',
    'Sunday: 11:00 AM – 9:00 PM',
  ],
  openNow: true,
  openingHoursPeriods: [
    {
      open: { day: 0, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 2 } },
      close: { day: 0, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 2 } },
    },
    {
      open: { day: 1, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 3 } },
      close: { day: 1, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 3 } },
    },
    {
      open: { day: 2, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 4 } },
      close: { day: 2, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 4 } },
    },
    {
      open: { day: 3, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 5 } },
      close: { day: 3, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 5 } },
    },
    {
      open: { day: 4, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 6 } },
      close: { day: 4, hour: 21, minute: 0, date: { year: 2025, month: 3, day: 6 } },
    },
    {
      open: { day: 5, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 7 } },
      close: { day: 5, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 7 } },
    },
    {
      open: { day: 6, hour: 11, minute: 0, date: { year: 2025, month: 3, day: 8 } },
      close: { day: 6, hour: 22, minute: 0, date: { year: 2025, month: 3, day: 8 } },
    },
  ],
  utcOffsetMinutes: undefined,
  photos: [],
  placeId: 'ChIJk8cmpsa33IcRbKLpDn3le4g',
  priceLevel: 'PRICE_LEVEL_MODERATE',
  rating: 4.6,
  ratingsTotal: undefined,
  placeTypes: ['pizza_restaurant', 'meal_takeaway', 'bar', 'restaurant', 'food', 'point_of_interest', 'establishment'],
  website: 'https://www.shakespeares.com/',
}

// Session

export const sessionId = 'abc123'

export const session: SessionRecord = {
  sessionId: 'abc123',
  address: 'Columbia, MO 65203, USA',
  location: { latitude: 38.9538484, longitude: -92.3714428 },
  currentRound: 0,
  bracket: [
    [
      ['choice-1', 'choice-2'],
      ['choice-3', 'choice-4'],
    ],
  ],
  byes: [null],
  isReady: true,
  errorMessage: null,
  timeoutAt: undefined,
  winner: null,
  expiration: 1728547851,
  type: ['restaurant'],
  exclude: ['breakfast_restaurant'],
  radius: 3757,
  rankBy: 'POPULARITY',
  filterClosingSoon: false,
  totalRounds: 2,
  votersSubmitted: 0,
}

// Choices

export const choiceDetail1: ChoiceDetail = {
  choiceId: 'choice-1',
  name: 'Flat Branch Pub & Brewing',
  formattedAddress: '115 S 5th St, Columbia, MO 65201, USA',
  formattedPhoneNumber: '(573) 499-0400',
  internationalPhoneNumber: '+1 573-499-0400',
  priceLevel: 'PRICE_LEVEL_MODERATE',
  rating: 4.5,
  ratingsTotal: 1200,
  photos: ['a-picture-stream'],
  openHours: ['Monday: 11:00 AM – 9:00 PM'],
  openNow: true,
  isClosingSoon: false,
  placeTypes: ['Pub', 'Bar', 'American'],
  website: 'http://www.flatbranch.com/',
}

export const choiceDetail2: ChoiceDetail = {
  choiceId: 'choice-2',
  name: "Shakespeare's Pizza - Downtown",
  formattedAddress: '225 S 9th St, Columbia, MO 65201, USA',
  formattedPhoneNumber: '(573) 449-2454',
  internationalPhoneNumber: '+1 573-449-2454',
  priceLevel: 'PRICE_LEVEL_MODERATE',
  rating: 4.6,
  ratingsTotal: 800,
  photos: [],
  openNow: true,
  isClosingSoon: false,
  placeTypes: ['Pizza', 'Bar'],
  website: 'https://www.shakespeares.com/',
}

export const choiceDetail3: ChoiceDetail = {
  choiceId: 'choice-3',
  name: "Addison's",
  formattedAddress: '709 Cherry St, Columbia, MO 65201, USA',
  rating: 4.3,
  ratingsTotal: 600,
  photos: ['photo-stream-3'],
  isClosingSoon: false,
  placeTypes: [],
}

export const choiceDetail4: ChoiceDetail = {
  choiceId: 'choice-4',
  name: 'Booches Billiard Hall',
  formattedAddress: '110 S 9th St, Columbia, MO 65201, USA',
  rating: 4.4,
  ratingsTotal: 500,
  photos: ['photo-stream-4'],
  isClosingSoon: false,
  placeTypes: [],
}

export const choicesRecord: ChoicesRecord = {
  choices: {
    'choice-1': choiceDetail1,
    'choice-2': choiceDetail2,
    'choice-3': choiceDetail3,
    'choice-4': choiceDetail4,
  },
  expiration: 1728547851,
}

// Users

export const userId = 'fuzzy-penguin'

export const userRecord: UserRecord = {
  userId: 'fuzzy-penguin',
  googleSub: null,
  name: null,
  phone: null,
  subscribedRounds: [],
  votes: [[null, null]],
  textsSent: 0,
  expiration: 1728547851,
}

// Inputs

export const newSessionInput: NewSessionInput = {
  address: 'Columbia, MO 65203, USA',
  type: ['restaurant'],
  exclude: ['breakfast_restaurant'],
  radiusMiles: 2.33,
  rankBy: 'POPULARITY',
}

export const shareInput: ShareInput = {
  phone: '+15551234567',
  type: 'text',
}

// JSON Patch

export const jsonPatchOperations: PatchOperation[] = [{ op: 'replace', path: '/votes/0/0', value: 'choice-1' }]

// reCAPTCHA

export const recaptchaToken = 'ytrewsdfghjmnbgtyu'

// Geocoding

export const geocodedAddress: GeocodedAddress = {
  address: 'Columbia, MO 65203, USA',
  latLng: {
    latitude: 39.0013395,
    longitude: -92.3128326,
  },
}

export const geocodeResult = {
  data: {
    results: [
      {
        address_components: [
          {
            long_name: '65202',
            short_name: '65202',
            types: ['postal_code'],
          },
          {
            long_name: 'Columbia',
            short_name: 'Columbia',
            types: ['locality', 'political'],
          },
          {
            long_name: 'Missouri',
            short_name: 'MO',
            types: ['administrative_area_level_1', 'political'],
          },
          {
            long_name: 'United States',
            short_name: 'US',
            types: ['country', 'political'],
          },
        ],
        formatted_address: 'Columbia, MO 65203, USA',
        geometry: {
          bounds: {
            northeast: {
              lat: 39.1343699,
              lng: -92.0693709,
            },
            southwest: {
              lat: 38.86871,
              lng: -92.49803009999999,
            },
          },
          location: {
            lat: 39.0013395,
            lng: -92.31283259999999,
          },
          location_type: 'APPROXIMATE',
          viewport: {
            northeast: {
              lat: 39.1343699,
              lng: -92.0693709,
            },
            southwest: {
              lat: 38.86871,
              lng: -92.49803009999999,
            },
          },
        },
        place_id: 'ChIJH1jvHSXG3IcRT7WVXYMmQ6w',
        postcode_localities: [
          'Cleveland Township',
          'Columbia',
          'Columbia Township',
          'Katy Township',
          'Missouri Township',
          'Perche Township',
          'Rocky Fork Township',
        ],
        types: ['postal_code'],
      },
    ],
    status: 'OK',
  },
}

export const reverseGeocodeResult = {
  plus_code: {
    compound_code: 'VXX7+59P Washington, DC, USA',
    global_code: '87C4VXX7+59P',
  },
  results: [
    {
      address_components: [
        {
          long_name: '1600',
          short_name: '1600',
          types: ['street_number'],
        },
        {
          long_name: 'Pennsylvania Avenue Northwest',
          short_name: 'Pennsylvania Avenue NW',
          types: ['route'],
        },
        {
          long_name: 'Northwest Washington',
          short_name: 'Northwest Washington',
          types: ['neighborhood', 'political'],
        },
        {
          long_name: 'Washington',
          short_name: 'Washington',
          types: ['locality', 'political'],
        },
        {
          long_name: 'District of Columbia',
          short_name: 'DC',
          types: ['administrative_area_level_1', 'political'],
        },
        {
          long_name: 'United States',
          short_name: 'US',
          types: ['country', 'political'],
        },
        {
          long_name: '20500',
          short_name: '20500',
          types: ['postal_code'],
        },
      ],
      formatted_address: '1600 Pennsylvania Avenue NW, Washington, DC 20500, USA',
      geometry: {
        location: {
          lat: 38.8976633,
          lng: -77.03657389999999,
        },
        location_type: 'ROOFTOP',
        viewport: {
          northeast: {
            lat: 38.8990122802915,
            lng: -77.0352249197085,
          },
          southwest: {
            lat: 38.8963143197085,
            lng: -77.0379228802915,
          },
        },
      },
      place_id: 'ChIJcw5BAI63t4kRj5qZY1MSyAo',
      plus_code: {
        compound_code: 'VXX7+39 Washington, DC, USA',
        global_code: '87C4VXX7+39',
      },
      types: ['street_address'],
    },
  ],
  status: 'OK',
}

// Place response

export const placeResponse = {
  places: [
    {
      id: 'ChIJ34KrisW33IcRdVRBVG0IFrA',
      types: ['pub', 'bar', 'american_restaurant', 'restaurant', 'food', 'point_of_interest', 'establishment'],
      nationalPhoneNumber: '(573) 499-0400',
      internationalPhoneNumber: '+1 573-499-0400',
      formattedAddress: '115 S 5th St, Columbia, MO 65201, USA',
      rating: 4.5,
      websiteUri: 'http://www.flatbranch.com/',
      priceLevel: 'PRICE_LEVEL_MODERATE',
      displayName: {
        text: 'Flat Branch Pub & Brewing',
        languageCode: 'en',
      },
      currentOpeningHours: {
        openNow: true,
        periods: [
          {
            open: {
              day: 0,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 2,
              },
            },
            close: {
              day: 0,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 2,
              },
            },
          },
          {
            open: {
              day: 1,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 3,
              },
            },
            close: {
              day: 1,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 3,
              },
            },
          },
          {
            open: {
              day: 2,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 4,
              },
            },
            close: {
              day: 2,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 4,
              },
            },
          },
          {
            open: {
              day: 3,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 5,
              },
            },
            close: {
              day: 3,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 5,
              },
            },
          },
          {
            open: {
              day: 4,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 6,
              },
            },
            close: {
              day: 4,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 6,
              },
            },
          },
          {
            open: {
              day: 5,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 7,
              },
            },
            close: {
              day: 5,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 7,
              },
            },
          },
          {
            open: {
              day: 6,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 8,
              },
            },
            close: {
              day: 6,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 8,
              },
            },
          },
        ],
        weekdayDescriptions: [
          'Monday: 11:00 AM – 9:00 PM',
          'Tuesday: 11:00 AM – 10:00 PM',
          'Wednesday: 11:00 AM – 10:00 PM',
          'Thursday: 11:00 AM – 10:00 PM',
          'Friday: 11:00 AM – 10:00 PM',
          'Saturday: 11:00 AM – 10:00 PM',
          'Sunday: 11:00 AM – 9:00 PM',
        ],
        nextCloseTime: '2025-03-03T03:00:00Z',
      },
      editorialSummary: {
        text: 'Warehouse setting for house-brewed beer, a big selection of whiskey & upscale American pub fare.',
        languageCode: 'en',
      },
      photos: [
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ1xGonc0P6fSjsH7hq484PdNecMR0Ht8gmDTNQlJfc0lBBXVqu-GXTwPlQkkfC6-8UW1Uq77taI5avNNTvj2lN_iZ-iZMgeDp3BvvEQEsjFPya1Rpf0E_RvsNfxt-qWyXu70i8S7-yw41TdbK6pnL1BONWjRhZeQntqnEfJ9q9_RihxJT3NXY0uHI8L6xkofBMNSzwsn9qM7cXmZpAN7bL0TlxsKbJI61nNd884zxJLqxaVK7RIE4Vi22tCa02YEeL3OHPPWPbMTwt_CphXLrJobnwv4X-q2s5hJ0iHIrL1kQ',
          widthPx: 4800,
          heightPx: 2741,
          authorAttributions: [
            {
              displayName: 'Flat Branch Pub & Brewing',
              uri: 'https://maps.google.com/maps/contrib/104529468427280244664',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjVuZyfawqiv4foEPZTPE4bL2HmuCvM0uD64a98NWgpWaPL-MqQ=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sAF1QipNeP2I6QZFTwFepSm3WjYWqbDfSbW4ggI3alCrl&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sAF1QipNeP2I6QZFTwFepSm3WjYWqbDfSbW4ggI3alCrl!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ2X4iPejh0ULW0cFNSuKM1bRNKW_tHDY9-VqR0oinLcczrdGN4PQq_OVzYjjVhgLjY8YkeqgB_CF_KIWQjYAFuzp3DdEA4vBYv0xr3psA5K-TTnucjTqUeHp7xEL_iiPD9Wwd_raWDO5v83tJOZXQ_weOBwfsqtdohxoCTJJVUMIWyrFMZYELciSNzWpM1WDMOVVJqVNq-uUqPXGaYwkL4qK7snUQ6_34cGicAADhIZ7TSQzqJrlrftb8KnIGVNaB2XuuoQd8na6B0CvlPFqvITuhYw-Jn-110paqJPkxB7Cw',
          widthPx: 4800,
          heightPx: 3203,
          authorAttributions: [
            {
              displayName: 'Flat Branch Pub & Brewing',
              uri: 'https://maps.google.com/maps/contrib/104529468427280244664',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjVuZyfawqiv4foEPZTPE4bL2HmuCvM0uD64a98NWgpWaPL-MqQ=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sAF1QipMJ5B4FFnHW_80xbtepPFJ3wfig39VoAWzei0Sf&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sAF1QipMJ5B4FFnHW_80xbtepPFJ3wfig39VoAWzei0Sf!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ2k9rg9Gn9BRxIp9kDc9TW5rjr9cGFe5B8FszMUzgrPBCMTo-ZMNQ-852uEaVou2ypZlrD1HyLEomhHGUlajOnk3WEZNR_lukfhRajMfh1Ew65BB1gY-iGEY-KTzqRJUXjbetKUIezFzKFyDT_s_IZ96bim1pFXlk7t0iOLKVZtNSJadtYMIFP4IRUuUiaZXtaIszdElWAfa8kmRvp4KIx6eo8173L-IE04jp7HWKx4xHkgrqYUbQarP5Y8wAAoM81QSjamKBLT9ZJIY09bOSp0zcDBd3tSgP38YAbRCzftiw',
          widthPx: 2048,
          heightPx: 1183,
          authorAttributions: [
            {
              displayName: 'Flat Branch Pub & Brewing',
              uri: 'https://maps.google.com/maps/contrib/104529468427280244664',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjVuZyfawqiv4foEPZTPE4bL2HmuCvM0uD64a98NWgpWaPL-MqQ=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sAF1QipN0fwDgqaDYIYxhgcw1FTALwo0KCWqcwABDfnh_&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sAF1QipN0fwDgqaDYIYxhgcw1FTALwo0KCWqcwABDfnh_!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ3JCKlISp27KilIwIx7x6aWfA6f8TYBNWvCsnc6nPxq6sxanlwUzAJxaOuvCWeYjar122AApy9RmGsJ6JIDmsvD9IdAO848BnIuE3V-BXIlDtshunBAU1sP2iRLSH1x3wEDc6C5Nb4iaTsjErkjy69BRhSA-80BE0ItjAEh0rgaQB0jmLmmtilJKBSCthQOBJ8xEaMKwYZwuT6Ppnc5YHnT40Nj3dtnjvdpjBJfpCP-JnLCmdqxupf9NpP8g55Q-qiefC4AhYoGPrNjwRz8U7D_8H7TO2_zmsgJ0iMau5wrzbYYyxzJUwi-jsDw1bRBOGDgr3ioszngS--MJbCv9itS1K7qsbQqS6cgNW2KlJ_OGYSNhxmV-hk1v736pKxIoOlx0FWpSB6sFGBZUEdhqDQMpXUvItrSISic',
          widthPx: 3072,
          heightPx: 4080,
          authorAttributions: [
            {
              displayName: 'FlashKen',
              uri: 'https://maps.google.com/maps/contrib/100320069886765280174',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjWv5_ZGGDYmJ-FMxd_w21npvwnlmixPJaqi6DNDI5Wz442_THVS=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgICXw-qJtgE&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgICXw-qJtgE!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ0sq6G14nhYO8j1idCweZLghqu01_1cPiAPx7NV1CuN7Rt5DhTV6L49tYaynoQbht2nkDiOSHqq4tw-yM7PsIV6CyLgRBvxq7H8Ml6Y_9LfHytluG6g7F0cTAsIxm-g__-tDd98l02cRyu_kHxgvkya1DHGkYoznZqhsaMPjMMdXFvlRcWIfuQscay3595mbyHrfRS5perK9j_8eZfKdHgb8eFuWUO1MuxZW5pI2OgZt-j0lwHFeiRIQtcrRSA2x0DVmRrLcceN2LBnQh4hF2AISQDjtaX-uwI3go_vTKtW3qaqqw_gQ4p4R3rXkVQto6aD75grYaKmmU9Q_TjU9h_rPksyFqQic-qq12LapanCiq7BfzdIWnyqG3hmBdJMj8zlUypEEv2hx7cGmEvBle0inSUudSK_IEn-',
          widthPx: 4800,
          heightPx: 3600,
          authorAttributions: [
            {
              displayName: 'Jen Benningfield',
              uri: 'https://maps.google.com/maps/contrib/101506829786267619772',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjX4R8C4xrOj6zPKCSPKDD8oSbUFUFKgRPDoaapbRDsUIHIiPr8z=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgICj7q2IvQE&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgICj7q2IvQE!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ3fR3znDmQcEWXL75fcx1h2PT74x-28y5IO1vfqFmSCHzsh1wmz2BmStxSlskwyr2u8yOOulMdirR4wzYfwTjqhhxBbxjyIZGQCWwy4XfTbtwULtHz01lPa2ABUOCUw0B3UlfG0xs-VxFTqRfSWAmJu9EVqXLeqB6GZcj0kidIhCJU-6dmDmcRgfrORYvii4vOuRjZH4pHA2rz_i8QvSJDSV2VMK9V7msTYmm3VGendLq2bjd7B-NXpvW44XdvEpgISo20l7nHNLyBQO-NH69hvDVMlG4SZyKPawhXExOdOPsYEByM6y20rUBygg2ZOZDLPsMJcCPqp1OQ0X7uX9G_x2yCmTIa2TqMZ5RmBm3l5W4lIfHH-SVrQF9Km418fsMHPf_vzYnKVaSfYmA4CzTp6Jt7IlZow',
          widthPx: 4032,
          heightPx: 3024,
          authorAttributions: [
            {
              displayName: 'Mia Kitty',
              uri: 'https://maps.google.com/maps/contrib/104898819944919977652',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjX2VuFqCQkhb2G7V685dvnSVo78UuIvQf8gw8r_xfTCWATPVWSp5g=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgIDdx529CQ&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgIDdx529CQ!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ2MILQTGqy2zu6G8flsVLNnKs98u5oJbabJtYay0Fu1XDezxpvUmgGoraBegfy4HObwdf7U5tubdebmNaEaxtdFm4gM2phbmTa62-l8xzHcD_thf81hwYj_ldFJHfNycHjVi27uS8jXLEKznt39Hos0S5RksiPVCiuxtnfohsszCR88o-W2TaxK4V028guIhPS3kVO8i3ykzqI9wZ2eDhnL8LBt7o_GKVCWkILaHY2frO2OU4TuBVVM1NneFfZ0l5vcwpL3yIRe78jU0qW5EYkMqNMiKoR0x7_2SiLgvYsVMzJsvAD3A_lCIlyxZ9qndBRfNcONoAbt51aSYCGNjrciLFt3uktZiDUyveuamqU6TuwxcfUfdxSYFrxFY1H2Z6pZEmbmO2oovJ78nOp4rWhIg30EWLNQ',
          widthPx: 4800,
          heightPx: 3600,
          authorAttributions: [
            {
              displayName: 'Rishi Joshi',
              uri: 'https://maps.google.com/maps/contrib/111548602893252199631',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjWWjcSdrh0r_7-ZXULp781ptpVJaptxL-s2omrHC8k9IRuqoSELkw=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgIDnlI-FeA&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgIDnlI-FeA!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ1AAUryfvcJEMpyuAi7AI_gVU9N-tl3aGim57L3kxrSwwBH-N1-1tmAc3o6Z9Fbns_2EOtILm1vW3A1x79ADOWnKmoNAWjUCHvluzF8tJoOvZ52bb6rpPgZitizUr2uWb5nVrZn1NEd01GNJrHfkzRNsJhnL7U9L0TnQcu8CAcdURO8iWtv8-BFSDQI0R7hj6zZ3QQUpnk5hICfRCyNqmJXgOqXn93ghVzCG8ZDQZG1e99hjcF156K25e97tok7xSBQKPMSc8cm7bUr6GJEjW1UN7bSdUMKaTBucFroicNMpSQmoq6aGwD_4WtWbrtHM3GBXfZO0-gDkC6iwOkc-V9aEQzJ4abBUX8OD28Be1fbeWIdYzAT1IdUdLjwqy1imZPJIT_rPFNDE6gl-RbqWy0KoIuOJ0ME6L98',
          widthPx: 4000,
          heightPx: 3000,
          authorAttributions: [
            {
              displayName: 'Brad Peuster',
              uri: 'https://maps.google.com/maps/contrib/111214359215417767597',
              photoUri:
                'https://lh3.googleusercontent.com/a/ACg8ocJDxYtImEMMGZUBv5d9dEkVdUNqE4XXV4eE5cy2r68VTkQwvw=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgIDr8o_S3wE&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgIDr8o_S3wE!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ00_fvpG67lGxJ5b06WIL4g7sNnhrflUM7EicsgiFQ1L6dv8eGsxM1JrFXnrCUklFFn1AYWRvgdMfWDCxD-9HdQuI-axTMsyN6bDbtYWT473ZIsOcDh5BW31WNGBJ-ygMvTlNqZlCb31YIuowpG6M0RbEIuW5DF6ix0Y4kwXRD1248TrKiZ3zEe-YuZaTfb69nPE8RHdYpjavCxXxyQ_uK3PIW-5Tdwk8Jtd61XWOy-ROESFVIaQRU24QqHq6Vat03bWVi_rez-KQtU8mmvPUbpiLdPS9DbV3TBthu7aeiOnLRsA15DyLan0Jk5w3XAdBgAH2wGIQCOJ2kA0xevaxpS20Bb0GUTMtB3QtMQ_orltgD-TxIkNNQ6ELwhVMQPKJfzeTAPQVbkagcufH06OIeOcZAgIp1jtg',
          widthPx: 3000,
          heightPx: 4000,
          authorAttributions: [
            {
              displayName: 'Sharon Sweezey',
              uri: 'https://maps.google.com/maps/contrib/110310522786089759124',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjWtHlpEtCMWOpd1ieSFHeJJPtWfxMFG7B1Eh0fJ4yTAd9g0sR0=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgID33ZaiiAE&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgID33ZaiiAE!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
        {
          name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/photos/AUy1YQ04wu8kwJhCE8Qqra90awEnhGCuN1Hw9CXy2lOIqNM7EXAg9hQDJo6Y91w7_1DDgJNY1QGDefShsFFzZdnXGhVz93NgsJQ7nVA4SKFodQne5SXES0MrPWOu1HwN16MPsyIezh3VfrT4a_k02UEhe25KNVvaQtd9TNgfLr6KxYxxoP_l0wuj0F2JCl4gfKcLF5neXFgNcchlxd4rRxYcHBa_tpmpmpKzsaBSvCBVvxbwa6-uHuT0MVIsRRyLnkHQM7kysGijCzLQrWo5n0iAXjwQ7VJzvxwvDt-tFjsQV6KOzbrekmqs8pZZpaoZeMQxHeNQ2zVYxGuaVbtA2OCmMCqs7P4c8H5VyWiAeHR9TaBpnVTKYwIX3VJABuhLswGo7bHu5m1Pva-BEV2OcVxmOZ6FGlpnOxY0JDxD',
          widthPx: 4000,
          heightPx: 2252,
          authorAttributions: [
            {
              displayName: 'Bill Cooley',
              uri: 'https://maps.google.com/maps/contrib/112489375908001161377',
              photoUri:
                'https://lh3.googleusercontent.com/a-/ALV-UjVS9sBGefWMXGx6Q4QMlgnLPprWjtjQnmEWFC8EcvJaxnnmoW8BMQ=s100-p-k-no-mo',
            },
          ],
          flagContentUri:
            'https://www.google.com/local/imagery/report/?cb_client=maps_api_places.places_api&image_key=!1e10!2sCIHM0ogKEICAgICT4d6SuQE&hl=en-US',
          googleMapsUri:
            'https://www.google.com/maps/place//data=!3m4!1e2!3m2!1sCIHM0ogKEICAgICT4d6SuQE!2e10!4m2!3m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
        },
      ],
      generativeSummary: {
        overview: {
          text: 'Upscale industrial eatery with a patio featuring a selection of housemade brews and comfort food.',
          languageCode: 'en-US',
        },
        description: {
          text: 'Family-friendly brewpub operating since 1841 and offering an extensive menu to eat in or on a patio.\nThe food gets outstanding reviews. Popular dishes include pizza, crab cakes, catfish, and chicken tenders. The drinks menu features award-winning beers, including blackberry wheat and green chili ale. There are also cocktails and wine.\nReviewers like the atmosphere and the service.\nCustomers typically spend $10–20.',
          languageCode: 'en-US',
        },
        references: {
          reviews: [
            {
              name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/reviews/ChZDSUhNMG9nS0VJQ0FnSUN4bXYyY2NREAE',
              relativePublishTimeDescription: 'a year ago',
              rating: 5,
              text: {
                text: 'Fantastic restaurant! Amazing food, excellent service, and delightful ambiance. Highly recommended!',
                languageCode: 'en',
              },
              originalText: {
                text: 'Fantastic restaurant! Amazing food, excellent service, and delightful ambiance. Highly recommended!',
                languageCode: 'en',
              },
              authorAttribution: {
                displayName: 'Payam Haas',
                uri: 'https://www.google.com/maps/contrib/109547468539422513661/reviews',
                photoUri:
                  'https://lh3.googleusercontent.com/a/ACg8ocJ8QwQI_CbvqOsDs8tyK52m10zjY9Vxa4HK6D-d_-o1jAVb6NY=s128-c0x00000000-cc-rp-mo-ba4',
              },
              publishTime: '2023-05-15T16:24:13.353227Z',
              flagContentUri:
                'https://www.google.com/local/review/rap/report?postId=ChZDSUhNMG9nS0VJQ0FnSUN4bXYyY2NREAE&d=17924085&t=1',
              googleMapsUri:
                'https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChZDSUhNMG9nS0VJQ0FnSUN4bXYyY2NREAE!2m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
            },
            {
              name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/reviews/ChZDSUhNMG9nS0VJQ0FnSUNKdnU3Q0lBEAE',
              relativePublishTimeDescription: 'a year ago',
              rating: 5,
              text: {
                text: 'Justin was our server in the bar and was fantastic. Have great recommendations and super service. We had student in from out of state who loved the garden atmosphere.',
                languageCode: 'en',
              },
              originalText: {
                text: 'Justin was our server in the bar and was fantastic. Have great recommendations and super service. We had student in from out of state who loved the garden atmosphere.',
                languageCode: 'en',
              },
              authorAttribution: {
                displayName: 'tara atchison-green',
                uri: 'https://www.google.com/maps/contrib/109706878550082833168/reviews',
                photoUri:
                  'https://lh3.googleusercontent.com/a/ACg8ocLImyROtF_jZh5wb5RfDnSPjXohG47tVfrVwWzmyypDcqELYw=s128-c0x00000000-cc-rp-mo-ba4',
              },
              publishTime: '2023-06-28T06:25:05.185530Z',
              flagContentUri:
                'https://www.google.com/local/review/rap/report?postId=ChZDSUhNMG9nS0VJQ0FnSUNKdnU3Q0lBEAE&d=17924085&t=1',
              googleMapsUri:
                'https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChZDSUhNMG9nS0VJQ0FnSUNKdnU3Q0lBEAE!2m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
            },
            {
              name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/reviews/ChdDSUhNMG9nS0VJQ0FnSUNKNWRLTDhnRRAB',
              relativePublishTimeDescription: 'a year ago',
              rating: 5,
              text: {
                text: 'If you like breweries that serve great food, this is the place to go. We had a party of four. Our food was really good but the server we had was outstanding! I love the interior of the building and they have an outdoor dining space as well. It’s a great place and I think you’ll be glad you went.',
                languageCode: 'en',
              },
              originalText: {
                text: 'If you like breweries that serve great food, this is the place to go. We had a party of four. Our food was really good but the server we had was outstanding! I love the interior of the building and they have an outdoor dining space as well. It’s a great place and I think you’ll be glad you went.',
                languageCode: 'en',
              },
              authorAttribution: {
                displayName: 'Roy Merideth',
                uri: 'https://www.google.com/maps/contrib/115415377353064353738/reviews',
                photoUri:
                  'https://lh3.googleusercontent.com/a-/ALV-UjWC0ErgD7ME7SPoDrNedsslix9qa1E9vj1k2V5KrzoGdA3uBOYOPQ=s128-c0x00000000-cc-rp-mo-ba3',
              },
              publishTime: '2023-07-01T14:13:50.722630Z',
              flagContentUri:
                'https://www.google.com/local/review/rap/report?postId=ChdDSUhNMG9nS0VJQ0FnSUNKNWRLTDhnRRAB&d=17924085&t=1',
              googleMapsUri:
                'https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChdDSUhNMG9nS0VJQ0FnSUNKNWRLTDhnRRAB!2m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
            },
            {
              name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/reviews/ChdDSUhNMG9nS0VJQ0FnSUR4N2ZYSDJRRRAB',
              relativePublishTimeDescription: 'a year ago',
              rating: 5,
              text: {
                text: 'Sooo good! In love with the food and the drinks. My favorite beers they make are the blackberry wheat and the green chili ale. Green chili ale goes great with the chicken tenders. Delicious!',
                languageCode: 'en',
              },
              originalText: {
                text: 'Sooo good! In love with the food and the drinks. My favorite beers they make are the blackberry wheat and the green chili ale. Green chili ale goes great with the chicken tenders. Delicious!',
                languageCode: 'en',
              },
              authorAttribution: {
                displayName: 'Maggie Stewart',
                uri: 'https://www.google.com/maps/contrib/113321648004630561392/reviews',
                photoUri:
                  'https://lh3.googleusercontent.com/a-/ALV-UjWpk7k93XIKd66JFTQlpaWmqqf-loGQl-CEOe2zCAV5P7H4DbpqRQ=s128-c0x00000000-cc-rp-mo-ba4',
              },
              publishTime: '2023-06-13T16:24:20.244222Z',
              flagContentUri:
                'https://www.google.com/local/review/rap/report?postId=ChdDSUhNMG9nS0VJQ0FnSUR4N2ZYSDJRRRAB&d=17924085&t=1',
              googleMapsUri:
                'https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChdDSUhNMG9nS0VJQ0FnSUR4N2ZYSDJRRRAB!2m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
            },
            {
              name: 'places/ChIJ34KrisW33IcRdVRBVG0IFrA/reviews/ChdDSUhNMG9nS0VJQ0FnSURKc2RDZHd3RRAB',
              relativePublishTimeDescription: 'a year ago',
              rating: 5,
              text: {
                text: "Meat lover's pizza and honey wheat beer were delicious",
                languageCode: 'en',
              },
              originalText: {
                text: "Meat lover's pizza and honey wheat beer were delicious",
                languageCode: 'en',
              },
              authorAttribution: {
                displayName: 'Darin Williams',
                uri: 'https://www.google.com/maps/contrib/100392117287568048767/reviews',
                photoUri:
                  'https://lh3.googleusercontent.com/a-/ALV-UjWZsl_hdK7Ima5yxJ5xG4oPVcBpaeVb5l1B2tL4Pd4evrBX27f-=s128-c0x00000000-cc-rp-mo-ba3',
              },
              publishTime: '2023-07-18T23:55:17.050791Z',
              flagContentUri:
                'https://www.google.com/local/review/rap/report?postId=ChdDSUhNMG9nS0VJQ0FnSURKc2RDZHd3RRAB&d=17924085&t=1',
              googleMapsUri:
                'https://www.google.com/maps/reviews/data=!4m6!14m5!1m4!2m3!1sChdDSUhNMG9nS0VJQ0FnSURKc2RDZHd3RRAB!2m1!1s0x87dcb7c58aab82df:0xb016086d54415475',
            },
          ],
        },
        overviewFlagContentUri:
          'https://www.google.com/local/review/rap/report?postId=CiUweDg3ZGNiN2M1OGFhYjgyZGY6MHhiMDE2MDg2ZDU0NDE1NDc1MAI&d=17924085&t=12',
        descriptionFlagContentUri:
          'https://www.google.com/local/review/rap/report?postId=CiUweDg3ZGNiN2M1OGFhYjgyZGY6MHhiMDE2MDg2ZDU0NDE1NDc1MAM&d=17924085&t=12',
      },
      priceRange: {
        startPrice: {
          currencyCode: 'USD',
          units: '10',
        },
        endPrice: {
          currencyCode: 'USD',
          units: '20',
        },
      },
    },
    {
      id: 'ChIJk8cmpsa33IcRbKLpDn3le4g',
      types: ['pizza_restaurant', 'meal_takeaway', 'bar', 'restaurant', 'food', 'point_of_interest', 'establishment'],
      nationalPhoneNumber: '(573) 449-2454',
      internationalPhoneNumber: '+1 573-449-2454',
      formattedAddress: '225 S 9th St, Columbia, MO 65201, USA',
      rating: 4.6,
      websiteUri: 'https://www.shakespeares.com/',
      priceLevel: 'PRICE_LEVEL_MODERATE',
      displayName: {
        text: "Shakespeare's Pizza - Downtown",
        languageCode: 'en',
      },
      currentOpeningHours: {
        openNow: true,
        periods: [
          {
            open: {
              day: 0,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 2,
              },
            },
            close: {
              day: 0,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 2,
              },
            },
          },
          {
            open: {
              day: 1,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 3,
              },
            },
            close: {
              day: 1,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 3,
              },
            },
          },
          {
            open: {
              day: 2,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 4,
              },
            },
            close: {
              day: 2,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 4,
              },
            },
          },
          {
            open: {
              day: 3,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 5,
              },
            },
            close: {
              day: 3,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 5,
              },
            },
          },
          {
            open: {
              day: 4,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 6,
              },
            },
            close: {
              day: 4,
              hour: 21,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 6,
              },
            },
          },
          {
            open: {
              day: 5,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 7,
              },
            },
            close: {
              day: 5,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 7,
              },
            },
          },
          {
            open: {
              day: 6,
              hour: 11,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 8,
              },
            },
            close: {
              day: 6,
              hour: 22,
              minute: 0,
              date: {
                year: 2025,
                month: 3,
                day: 8,
              },
            },
          },
        ],
        weekdayDescriptions: [
          'Monday: 11:00 AM – 9:00 PM',
          'Tuesday: 11:00 AM – 9:00 PM',
          'Wednesday: 11:00 AM – 9:00 PM',
          'Thursday: 11:00 AM – 9:00 PM',
          'Friday: 11:00 AM – 10:00 PM',
          'Saturday: 11:00 AM – 10:00 PM',
          'Sunday: 11:00 AM – 9:00 PM',
        ],
        nextCloseTime: '2025-03-03T03:00:00Z',
      },
      editorialSummary: {
        text: 'Laid-back outpost dishing up pizza pies & salads, plus craft beer, cocktails & wine.',
        languageCode: 'en',
      },
      photos: undefined,
      generativeSummary: {
        overview: {
          text: 'Historic joint dishing up pizza by the pie or slice, as well as salads, beer, and cocktails.',
          languageCode: 'en-US',
        },
        overviewFlagContentUri:
          'https://www.google.com/local/review/rap/report?postId=CiUweDg3ZGNiN2M2YTYyNmM3OTM6MHg4ODdiZTU3ZDBlZTlhMjZjMAI&d=17924085&t=12',
      },
      priceRange: {
        startPrice: {
          currencyCode: 'USD',
          units: '10',
        },
        endPrice: {
          currencyCode: 'USD',
          units: '20',
        },
      },
    },
  ],
}
