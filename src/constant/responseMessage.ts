export default {
    SUCCESS: 'The Opeartion Has been successfull',
    SOMETHING_WENT_WRONG: 'Something went wrong',
    NOT_FOUND: (entity: string): string => {
        return `${entity} not found`;
    },
    // Flyanytrip / Adivaha specific
    TOKEN_GENERATED: 'Authentication token generated successfully',
    FARE_UNAVAILABLE: 'Fare is no longer available — please re-search for current fares',
    TOKEN_EXPIRED: 'Authentication token expired and could not be refreshed',
    ADIVAHA_UNREACHABLE: 'Adivaha API is currently unreachable',
    PARTIAL_CANCEL_FIELDS_REQUIRED: 'Sectors and TicketId are required for partial cancellation (RequestType 2)',
    CANCELLATION_WARNING: 'Cancellation is irreversible — forwarding to Adivaha',
    INVALID_OFFERED_FARE: 'OfferedFare must be a positive non-zero value',
};
