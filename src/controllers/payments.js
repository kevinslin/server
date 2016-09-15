import Promise from 'bluebird';
import stripeFactory from 'stripe';
const PRICE_PER_HOOK = 0.02;
const stripe = stripeFactory(process.env.STRIPE_TOKEN);

import isLinkPaid from 'helpers/isLinkPaid';

// Given a number of links, return the "payment quantity" that is set within stripe.
function getPaymentQuantityForLinks(linkCount) {
  return Math.ceil(linkCount / 5);
}

// Called when a paid link is added or changed
// Directly called by updatePaidLink below
export function changePaidLinkQuantity(User, user, amount) {
  if (user.customerId) {
    function createSubscription() {
      // create a subscription
      return stripe.subscriptions.create({
        customer: user.customerId,
        plan: '5_private_repo',
        quantity: getPaymentQuantityForLinks(amount),
        metadata: {
          repos: amount,
        },
      }).then(subscription => {
        return User.update({_id: user._id}, {subscriptionId: subscription.id}).exec();
      });
    }

    // create or update subscription?
    return stripe.subscriptions.retrieve(user.subscriptionId).then(subsc => {
      if (subsc) {
        // update the subscription
        return stripe.subscriptions.update(user.subscriptionId, {
          quantity: getPaymentQuantityForLinks(amount),
          metadata: {
            repos: amount,
          },
        });
      } else {
        return createSubscription();
      }
    }).catch(createSubscription);
  } else {
    return Promise.reject(new Error('Payment info not specified.'));
  }
}

// A paid link is defined as:
// - A link with a private repo within.
// - A link that is also enabled.
export function updatePaidLinks(Link, User, user) {
  return Link.find({owner: user, enabled: true}).exec().then(links => {
    let paidLinks = links.map(link => isLinkPaid(user, link));

    return Promise.all(paidLinks).then(linksPaid => {
      return linksPaid.filter(f => f).length;
    }).then(linkCount => {
      return changePaidLinkQuantity(User, user, linkCount);
    });
  });
}


// A route to get subscription information for the logged-in user.
export function getSubscriptionInformation(req, res) {
  if (req.isAuthenticated()) {
    if (req.user.subscriptionId) {
      return stripe.subscriptions.retrieve(req.user.subscriptionId).then(subsc => {
        res.status(200).send({
          status: 'ok',
          paymentBlockQuantity: subsc.quantity,
          paymentAmount: subsc.quantity * (subsc.plan.amount / 100),
        });
      }).catch(err => {
        res.status(500).send({error: "Server error"});
        process.env.NODE_ENV !== 'test' && (() => {throw err})()
      });
    } else {
      res.status(400).send({error: 'No subscription on the authenticated user.'});
    }
  } else {
    res.status(403).send({error: 'Not authenticated.'});
  }
}
