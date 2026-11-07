import { BookingMessages } from "./booking-messages";
import { HomeSearch } from "./home-search";

/** The search section on the home page. */
export function HomeAvailability() {
  return (
    <section className="section book-section" id="availability">
      <div className="wrap">
        <BookingMessages>
          <HomeSearch />
        </BookingMessages>
      </div>
    </section>
  );
}
