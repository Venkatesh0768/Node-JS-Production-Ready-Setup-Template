import prisma from '../lib/prisma';
import logger from '../util/logger';
import { PaxType } from '../generated/prisma/client';

export async function saveBookingToDB(reqBody: Record<string, any>, adivahaResponse: any, isLcc: boolean) {
    try {
        const raw = adivahaResponse;
        const outerResp = (raw && raw.responseData && raw.responseData.Response) ? raw.responseData.Response : (raw || {});
        const d = outerResp.Response || outerResp;
        const itinerary = d.FlightItinerary || {};

        const bookingIdRaw = d.BookingId || d.bookingId || outerResp.BookingId || 0;
        const bookingId = parseInt(bookingIdRaw, 10) || 0;
        const pnr = String(d.PNR || d.Pnr || d.pnr || outerResp.PNR || '');
        const orderId = String(raw && raw.order_id ? raw.order_id : (d.order_id || d.orderId || ''));

        if (!bookingId || !pnr) {
            logger.warn('Skipping DB save: missing bookingId or PNR in response', { meta: { bookingId, pnr } });
            return;
        }

        const traceId = String(reqBody.TraceId || reqBody.traceId || '');
        const resultIndex = String(reqBody.ResultIndex || reqBody.resultIndex || '');
        const isDomestic = reqBody.isDomestic === 'Yes' || reqBody.isDomestic === true;

        // Route details
        const segments = itinerary.Segments || [];
        const firstSegment = (Array.isArray(segments[0]) ? segments[0][0] : segments[0]) || {};
        const fromIata = firstSegment.Origin?.AirportCode || 'XXX';
        const toIata = firstSegment.Destination?.AirportCode || 'XXX';
        
        let departureDate = new Date();
        if (firstSegment.StopPointDepartureTime) {
            departureDate = new Date(firstSegment.StopPointDepartureTime);
        } else if (firstSegment.Origin?.DepTime) {
            departureDate = new Date(firstSegment.Origin.DepTime);
        }
        
        const airlineCode = firstSegment.Airline?.AirlineCode || 'XX';

        // Fare details (use requested fare, fallback to response fare)
        const reqFare = Array.isArray(reqBody.Passengers) && reqBody.Passengers[0]?.Fare ? reqBody.Passengers[0].Fare : {};
        const respFare = itinerary.Fare || {};
        
        const parseFare = (val: any) => parseFloat(val) || 0;
        
        const baseFare = parseFare(respFare.BaseFare ?? reqFare.BaseFare);
        const tax = parseFare(respFare.Tax ?? reqFare.Tax);
        const yqTax = parseFare(respFare.YQTax ?? reqFare.YQTax);
        const otherCharges = parseFare(respFare.OtherCharges ?? reqFare.OtherCharges);
        const publishedFare = parseFare(respFare.PublishedFare ?? reqFare.PublishedFare);
        const offeredFare = parseFare(respFare.OfferedFare ?? reqFare.OfferedFare);
        const discount = parseFare(respFare.Discount ?? reqFare.Discount);

        // Passengers
        const reqPassengers = Array.isArray(reqBody.Passengers) ? reqBody.Passengers : [];
        const respPassengers = Array.isArray(itinerary.Passenger) ? itinerary.Passenger : (itinerary.Passenger ? [itinerary.Passenger] : []);

        const passengerData = reqPassengers.map((reqPax: any, index: number) => {
            const respPax = respPassengers[index] || {};
            const ticketObj = respPax.Ticket || respPax || {};
            
            return {
                title: String(reqPax.Title || 'Mr').substring(0, 10),
                firstName: String(reqPax.FirstName || reqPax.first_name || ''),
                lastName: String(reqPax.LastName || reqPax.last_name || ''),
                paxType: (reqPax.PaxType == '1' || reqPax.PaxType === 'ADULT' ? 'ADULT' : (reqPax.PaxType == '2' || reqPax.PaxType === 'CHILD' ? 'CHILD' : 'INFANT')) as PaxType,
                gender: parseInt(reqPax.Gender || 1, 10),
                dateOfBirth: new Date(reqPax.DateOfBirth || '2000-01-01'),
                nationality: String(reqPax.Nationality || 'IN').substring(0, 5),
                countryCode: String(reqPax.CountryCode || 'IN').substring(0, 5),
                contactNo: String(reqPax.ContactNo || ''),
                email: String(reqPax.Email || ''),
                passportNo: reqPax.PassportNo || null,
                passportExpiry: reqPax.PassportExpiry ? new Date(reqPax.PassportExpiry) : null,
                isLeadPax: reqPax.IsLeadPax === true || reqPax.IsLeadPax === 'true',
                ticketId: parseInt(ticketObj.TicketId || 0, 10) || null,
                ticketNumber: ticketObj.TicketNumber || null,
                ticketStatus: String(ticketObj.Status || ''),
            };
        });

        const booking = await prisma.booking.create({
            data: {
                bookingId,
                pnr,
                orderId,
                traceId,
                resultIndex,
                isLcc,
                isDomestic,
                fromIata: fromIata.substring(0, 3),
                toIata: toIata.substring(0, 3),
                departureDate,
                airlineCode: airlineCode.substring(0, 4),
                baseFare,
                tax,
                yqTax,
                otherCharges,
                publishedFare,
                offeredFare,
                discount,
                status: 'CONFIRMED',
                passengers: {
                    create: passengerData
                }
            }
        });

        logger.info(`✅ Successfully saved booking ${booking.bookingId} to database`, { meta: { id: booking.id, pnr: booking.pnr } });
        return booking;
    } catch (error) {
        logger.error('❌ Failed to save booking to database', { meta: { error } });
    }
}
