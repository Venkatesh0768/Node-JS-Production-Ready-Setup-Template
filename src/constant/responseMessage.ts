export default {
    SUCCESS: 'The Opeartion Has been successfull',
    SOMETHING_WENT_WRONG: 'Something went wrong',
    NOT_FOUND: (entity: string): string => {
        return `${entity} not found`;
    },
};