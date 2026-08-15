const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// DYNAMODB_ENDPOINT is only set for local development (DynamoDB Local).
// Unset it in production and the SDK resolves the real endpoint, with
// credentials coming from the EC2 instance's IAM role.
const config = { region: process.env.AWS_REGION || 'ap-south-1' };
if (process.env.DYNAMODB_ENDPOINT) {
  config.endpoint = process.env.DYNAMODB_ENDPOINT;
}

const client = new DynamoDBClient(config);

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLES = {
  USERS: 'MovieBooking_Users',
  MOVIES: 'MovieBooking_Movies',
  THEATRES: 'MovieBooking_Theatres',
  SHOWS: 'MovieBooking_Shows',
  SEAT_LOCKS: 'MovieBooking_SeatLocks',
  BOOKINGS: 'MovieBooking_Bookings',
  SUPPORT: 'MovieBooking_SupportTickets',
  PENDING: 'MovieBooking_PendingSignups',
  REVIEWS: 'MovieBooking_Reviews',
};

/**
 * Query every page of a result set.
 *
 * DynamoDB caps a single Query at 1MB of read data and hands back a
 * LastEvaluatedKey rather than an error, so a plain `send()` silently returns
 * a partial answer. With a fortnight of showtimes per city that truncation is
 * reached easily — it showed up as a date strip listing five days instead of
 * fourteen. Anything that can legitimately exceed 1MB must page.
 *
 * @param {Function} CommandCtor  QueryCommand or ScanCommand
 * @param {object}   params       the usual command input
 * @param {number}   maxPages     safety valve against an unbounded loop
 */
async function queryAll(CommandCtor, params, maxPages = 50) {
  const items = [];
  let ExclusiveStartKey;
  let pages = 0;

  do {
    const res = await docClient.send(new CommandCtor({ ...params, ExclusiveStartKey }));
    if (res.Items) items.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
    pages++;
  } while (ExclusiveStartKey && pages < maxPages);

  if (ExclusiveStartKey) {
    console.warn(`queryAll stopped at ${maxPages} pages for ${params.TableName} — result may be partial`);
  }
  return items;
}

module.exports = { client, docClient, TABLES, queryAll };
